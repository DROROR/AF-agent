// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { JobsPage } from "./JobsPage";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EMPTY_HISTORY = { status: 200, body: { jobs: [] } };

describe("JobsPage", () => {
  it("lists real jobs currently claimed by a worker, derived from the live worker list", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": {
        status: 200,
        body: {
          api: "ok",
          database: "ok",
          workers: [
            {
              workerId: "11111111-1111-1111-1111-111111111111",
              name: "worker-a",
              status: "ONLINE",
              lastHeartbeatAt: new Date().toISOString(),
              aeStatus: "ONLINE",
              mcpStatus: "ONLINE",
              aeAvailability: "ONLINE",
              mcpAvailability: "ONLINE",
              aeVersion: "2026",
              capabilities: ["EXECUTE_FRAME"],
              maxConcurrency: 1,
              currentJobId: "22222222-2222-2222-2222-222222222222",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ],
          fetchedAt: new Date().toISOString()
        }
      },
      "/api/jobs": EMPTY_HISTORY
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Jobs / Queue");
    screen.getByText("worker-a");
    screen.getByText("22222222-2222-2222-2222-222222222222");
  });

  it("shows the honest empty state - never a fabricated job - when no worker currently has one claimed", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() } },
      "/api/jobs": EMPTY_HISTORY
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("No jobs currently claimed");
  });

  it("shows an error state when the status request itself fails", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 500, body: {} },
      "/api/jobs": EMPTY_HISTORY
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Jobs unavailable");
  });

  it("shows the real job history - completed/failed/in-progress - with worker/project names and errors resolved, never requiring DB access to understand a failure", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() } },
      "/api/jobs": {
        status: 200,
        body: {
          jobs: [
            {
              jobId: "33333333-3333-3333-3333-333333333333",
              operation: "EXECUTE_FRAME",
              status: "FAILED",
              workerId: "11111111-1111-1111-1111-111111111111",
              workerName: "worker-a",
              projectId: "44444444-4444-4444-4444-444444444444",
              projectName: "Real Client Project",
              executionSessionId: "55555555-5555-5555-5555-555555555555",
              error: { code: "NOT_AVAILABLE", message: "AE_UNRESPONSIVE (BRIDGE_TIMEOUT) - NEEDS HUMAN ACTION" },
              createdAt: "2026-08-29T00:00:00.000Z",
              completedAt: "2026-08-29T00:05:00.000Z",
              updatedAt: "2026-08-29T00:05:00.000Z"
            }
          ]
        }
      }
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Job history");
    await screen.findByText("Real Client Project");
    screen.getByText(/AE_UNRESPONSIVE \(BRIDGE_TIMEOUT\)/);
  });

  /**
   * REAL 2026-10-04: the whole page read "Response did not match the expected
   * job-history contract" because one row in the list could not be read.
   */
  it("one unreadable row never blanks the page - every other job is shown, and the page says one is missing", async () => {
    const readable = {
      jobId: "33333333-3333-3333-3333-333333333333",
      operation: "EXECUTE_FRAME",
      status: "SUCCEEDED",
      workerId: "11111111-1111-1111-1111-111111111111",
      workerName: "worker-a",
      projectId: "44444444-4444-4444-4444-444444444444",
      projectName: "Readable Project",
      executionSessionId: null,
      error: null,
      createdAt: "2026-10-04T00:00:00.000Z",
      completedAt: "2026-10-04T00:05:00.000Z",
      updatedAt: "2026-10-04T00:05:00.000Z"
    };
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() } },
      // The second row carries a status this build does not know.
      "/api/jobs": { status: 200, body: { jobs: [readable, { ...readable, jobId: "66666666-6666-6666-6666-666666666666", projectName: "Unreadable Project", status: "SOMETHING_NEW" }] } }
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Readable Project");
    screen.getByText("1 job could not be read and is not shown below. Every other job is listed.");
    expect(screen.queryByText("Job history unavailable")).toBeNull();
    expect(screen.queryByText("Unreadable Project")).toBeNull();
  });

  it("still reports the history as unavailable when the response is not a job list at all", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() } },
      "/api/jobs": { status: 200, body: { somethingElse: true } }
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Job history unavailable");
  });

  it("shows the honest empty state for job history when the user has never dispatched a job", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() } },
      "/api/jobs": EMPTY_HISTORY
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("No jobs dispatched yet");
  });
});
