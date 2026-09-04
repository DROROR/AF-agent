import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "../infrastructure/api-client.js";
import { reconcileAbandonedJobs } from "./reconcile-abandoned-jobs.js";

/**
 * Root-cause investigation (2026-09-04): job c19a2fb9 stayed RUNNING after
 * the client installed build bf680f0, and the production API log showed
 * ZERO requests to GET /api/workers/:id/jobs/active - ever. Every unit
 * test up to this point (reconcile-abandoned-jobs.test.ts,
 * list-active-jobs-for-worker.test.ts) used FAKE closures/an in-memory
 * repository - none of them exercised the REAL ApiClient.listActiveJobs
 * wire format (method/path/headers) the way index.ts actually wires it.
 * This file closes that gap: a real Node http.Server (real TCP, real
 * HTTP, real headers - not app.inject(), not a mocked fetch) stands in
 * for the API, and the real ApiClient + reconcileAbandonedJobs from
 * index.ts's own wiring run against it.
 */

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
}

const WORKER_ID = "345ee0a4-ef4d-4b87-a923-726f97144aa4";
const WORKER_TOKEN = "test-worker-token";
const STUCK_JOB_ID = "c19a2fb9-c385-4254-97ee-2930ff25f917";

let server: Server;
let baseUrl: string;
let requests: RecordedRequest[];
let respondActiveJobsWith: () => { status: number; body: unknown };
let respondReportWith: () => { status: number; body: unknown };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
  });
}

beforeEach(async () => {
  requests = [];
  respondActiveJobsWith = () => ({
    status: 200,
    body: {
      jobs: [
        {
          jobId: STUCK_JOB_ID,
          workerId: WORKER_ID,
          projectId: null,
          operation: "INSPECT_SCENE_EVIDENCE",
          status: "RUNNING",
          payload: {},
          result: null,
          error: null,
          checkpoint: null,
          createdAt: "2026-09-04T09:24:44.669Z",
          claimedAt: "2026-09-04T09:24:45.560Z",
          startedAt: "2026-09-04T09:24:45.560Z",
          completedAt: null,
          updatedAt: "2026-09-04T09:24:45.560Z"
        }
      ]
    }
  });
  respondReportWith = () => ({
    status: 200,
    body: {
      jobId: STUCK_JOB_ID,
      workerId: WORKER_ID,
      projectId: null,
      operation: "INSPECT_SCENE_EVIDENCE",
      status: "FAILED",
      payload: {},
      result: null,
      error: { code: "ABANDONED_RECONCILED", message: "reconciled" },
      checkpoint: null,
      createdAt: "2026-09-04T09:24:44.669Z",
      claimedAt: "2026-09-04T09:24:45.560Z",
      startedAt: "2026-09-04T09:24:45.560Z",
      completedAt: "2026-09-04T11:40:00.000Z",
      updatedAt: "2026-09-04T11:40:00.000Z"
    }
  });

  server = createServer(async (req, res) => {
    await readBody(req);
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });

    if (req.method === "GET" && req.url === `/api/workers/${WORKER_ID}/jobs/active`) {
      const { status, body } = respondActiveJobsWith();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    if (req.method === "POST" && req.url === `/api/workers/${WORKER_ID}/jobs/${STUCK_JOB_ID}/report`) {
      const { status, body } = respondReportWith();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a real TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function realWorkerWiring(apiClient: ApiClient) {
  // Exactly index.ts's own reconcileAbandonedJobs call site (bf680f0).
  return {
    listActiveJobs: () => apiClient.listActiveJobs(WORKER_ID, WORKER_TOKEN),
    reportJobStatus: (jobId: string, body: { status: "FAILED"; error: { code: "ABANDONED_RECONCILED"; message: string } }) =>
      apiClient.reportJobStatus(WORKER_ID, WORKER_TOKEN, jobId, body)
  };
}

describe("reconcileAbandonedJobs wired with the REAL ApiClient over a real HTTP server (P5 test 7 reproduction, 2026-09-04)", () => {
  it("emits exactly one real GET /api/workers/:id/jobs/active with the correct bearer token, and reports the abandoned job FAILED/ABANDONED_RECONCILED via a real POST", async () => {
    const apiClient = new ApiClient({ apiUrl: baseUrl });

    await reconcileAbandonedJobs(realWorkerWiring(apiClient));

    const getRequests = requests.filter((r) => r.method === "GET");
    expect(getRequests).toHaveLength(1);
    expect(getRequests[0]?.url).toBe(`/api/workers/${WORKER_ID}/jobs/active`);
    expect(getRequests[0]?.authorization).toBe(`Bearer ${WORKER_TOKEN}`);

    const postRequests = requests.filter((r) => r.method === "POST");
    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]?.url).toBe(`/api/workers/${WORKER_ID}/jobs/${STUCK_JOB_ID}/report`);
    expect(postRequests[0]?.authorization).toBe(`Bearer ${WORKER_TOKEN}`);
  });

  it("makes no POST at all when there is nothing active - the normal, unaffected case on every ordinary restart", async () => {
    respondActiveJobsWith = () => ({ status: 200, body: { jobs: [] } });
    const apiClient = new ApiClient({ apiUrl: baseUrl });

    await reconcileAbandonedJobs(realWorkerWiring(apiClient));

    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("FIXED (was the proven root cause): a transient failure on the GET is retried with bounded backoff, then succeeds - no longer permanently stranded after one failed attempt", async () => {
    let getAttempts = 0;
    server.removeAllListeners("request");
    server.on("request", async (req, res) => {
      await readBody(req);
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
      if (req.method === "GET" && req.url === `/api/workers/${WORKER_ID}/jobs/active`) {
        getAttempts += 1;
        if (getAttempts === 1) {
          // Simulate exactly one transient failure (e.g. a brief network/
          // DNS blip in the seconds right after a fresh process start) -
          // the kind of condition the real incident is fully consistent
          // with. Before the fix, this alone permanently stranded
          // reconciliation with zero further attempts.
          res.destroy();
          return;
        }
        const { status, body } = respondActiveJobsWith();
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
        return;
      }
      if (req.method === "POST" && req.url === `/api/workers/${WORKER_ID}/jobs/${STUCK_JOB_ID}/report`) {
        const { status, body } = respondReportWith();
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
        return;
      }
      res.writeHead(404).end();
    });

    const apiClient = new ApiClient({ apiUrl: baseUrl });
    await reconcileAbandonedJobs({
      ...realWorkerWiring(apiClient),
      retryOptions: { maxAttempts: 4, policy: { baseMs: 5, maxMs: 20 } },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    });

    expect(getAttempts).toBe(2); // failed once, retried once, succeeded
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1); // still reconciled the job it eventually found
  });

  it("gives up after exhausting retry attempts and logs clearly, rather than retrying forever", async () => {
    let getAttempts = 0;
    server.removeAllListeners("request");
    server.on("request", async (req, res) => {
      await readBody(req);
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
      getAttempts += 1;
      res.destroy(); // every attempt fails
    });
    const warn: string[] = [];

    const apiClient = new ApiClient({ apiUrl: baseUrl });
    await reconcileAbandonedJobs({
      ...realWorkerWiring(apiClient),
      retryOptions: { maxAttempts: 3, policy: { baseMs: 5, maxMs: 20 } },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      logger: { info: () => {}, warn: (_meta, message) => warn.push(message) }
    });

    expect(getAttempts).toBe(3);
    expect(warn.some((m) => m.includes("exhausting all retry attempts"))).toBe(true);
  });
});
