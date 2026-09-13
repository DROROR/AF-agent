// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewProjectWizard } from "./NewProjectWizard";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { LocaleProvider } from "./LocaleProvider";
import { stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

/**
 * REPRODUCTION FROM PRODUCTION DATA (2026-09-13). Operator report: on the New
 * Project wizard FAHADNAKASH was selected but Inspect Template stayed
 * disabled "since yesterday", and no inspection job was ever created.
 *
 * Root cause: the wizard remembers its in-flight INSPECT_TEMPLATE job in
 * localStorage and restores it on every mount. The draft was only ever
 * cleared after a successful Create Project. The account's last wizard
 * dispatch, df76c2be, was CANCELLED during QA triage - and the wizard only
 * allowed re-inspecting when there was no job or the job had FAILED. A
 * restored CANCELLED job therefore disabled the button permanently, rendered
 * no explanation, and nothing in the UI could clear it.
 *
 * Every value below is the EXACT DTO the current account's session received
 * from production (reproduced through the real toWorkerDto / toJobDto mappers
 * and accepted by the deployed web schema).
 */

const FAHADNAKASH = {
  workerId: "accd0a71-dbd6-4a53-8b81-d3fe4609420b",
  name: "FAHADNAKASH",
  status: "ONLINE",
  lastHeartbeatAt: "2026-09-13T10:07:26.489Z",
  aeStatus: "ONLINE",
  mcpStatus: "ONLINE",
  aeAvailability: "ONLINE",
  mcpAvailability: "ONLINE",
  aeVersion: "2026",
  capabilities: ["CHECK_HEALTH", "INSPECT_TEMPLATE", "INSPECT_SCENE_EVIDENCE", "INSPECT_RENDER_CAPABILITIES", "EXECUTE_FRAME", "RENDER", "CREATE_PREVIEW", "RUN_DIAGNOSTIC", "RESTART_WORKER_SAFE"],
  maxConcurrency: 1,
  currentJobId: null,
  createdAt: "2026-09-07T12:32:14.436Z",
  updatedAt: "2026-09-13T10:07:26.489Z"
};

const SOURCE_PATH = "C:\\DYO-Agent\\copies\\mixkit-smartphone-promo-596\\596\\App_Promo.aep";
const CANCELLED_JOB_ID = "df76c2be-3cfc-4ccd-8048-8203efbbe44c";

const CANCELLED_JOB = {
  jobId: CANCELLED_JOB_ID,
  workerId: FAHADNAKASH.workerId,
  projectId: null,
  operation: "INSPECT_TEMPLATE",
  status: "CANCELLED",
  payload: { templateId: "mixkit-smartphone-promo-596", sourceProjectPath: SOURCE_PATH },
  result: null,
  error: { code: "WORKER_OFFLINE", message: "Cancelled during QA triage: FAHADNAKASH stopped heartbeating at 14:19:52Z, 14s after this job was created, so it was never claimed." },
  checkpoint: null,
  createdAt: "2026-09-12T14:19:38.162Z",
  claimedAt: null,
  startedAt: null,
  completedAt: "2026-09-12T14:35:35.439Z",
  updatedAt: "2026-09-12T14:35:35.439Z"
};

const PENDING_JOB_STORAGE_KEY = "dyo:new-project-wizard:pending-inspect-job";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function seedTheRealStaleDraft(): void {
  window.localStorage.setItem(
    PENDING_JOB_STORAGE_KEY,
    JSON.stringify({ jobId: CANCELLED_JOB_ID, workerId: FAHADNAKASH.workerId, templateId: "mixkit-smartphone-promo-596", sourceProjectPath: SOURCE_PATH, name: "Mixkit Smartphone Promo" })
  );
}

function stubProduction(newJobId = "7aa11111-1111-4111-8111-111111111111"): void {
  stubFetchByUrl({
    "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [FAHADNAKASH], fetchedAt: "2026-09-13T10:07:30.000Z" } },
    [`/api/jobs/${CANCELLED_JOB_ID}`]: { status: 200, body: { job: CANCELLED_JOB } },
    "/api/jobs": {
      status: 201,
      body: { jobId: newJobId, workerId: FAHADNAKASH.workerId, operation: "INSPECT_TEMPLATE", status: "QUEUED", createdAt: "2026-09-13T10:08:00.000Z" }
    }
  });
}

function renderWizard(): void {
  render(
    <LocaleProvider>
      <DashboardStatusProvider>
        <NewProjectWizard />
      </DashboardStatusProvider>
    </LocaleProvider>
  );
}

const inspectButton = () => screen.getByRole("button", { name: /Inspect Template|Inspect again/ }) as HTMLButtonElement;

describe("NewProjectWizard - stale draft for a CANCELLED inspection (production reproduction)", () => {
  it("renders the selected worker's real statuses from the exact production DTO", async () => {
    seedTheRealStaleDraft();
    stubProduction();
    renderWizard();

    await waitFor(() => expect(screen.getAllByText("Online").length).toBeGreaterThanOrEqual(3), { timeout: 5000 });
  });

  it("does NOT leave Inspect Template permanently disabled after restoring a CANCELLED job", async () => {
    seedTheRealStaleDraft();
    stubProduction();
    renderWizard();

    await waitFor(() => expect(screen.getAllByText("Online").length).toBeGreaterThanOrEqual(3), { timeout: 5000 });
    await waitFor(() => expect(inspectButton().disabled).toBe(false), { timeout: 5000 });
  });

  it("explains that the previous inspection was cancelled, instead of showing a silent dead button", async () => {
    seedTheRealStaleDraft();
    stubProduction();
    renderWizard();

    await waitFor(() => expect(screen.getByText(/previous inspection was cancelled/i)).not.toBeNull(), { timeout: 5000 });
  });

  it("clears the stale draft, so a refresh can never re-lock the wizard", async () => {
    seedTheRealStaleDraft();
    stubProduction();
    renderWizard();

    await waitFor(() => expect(window.localStorage.getItem(PENDING_JOB_STORAGE_KEY)).toBeNull(), { timeout: 5000 });
  });

  it("lets the operator dispatch exactly ONE new inspection for FAHADNAKASH with the restored path", async () => {
    seedTheRealStaleDraft();
    stubProduction();
    renderWizard();

    await waitFor(() => expect(inspectButton().disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(inspectButton());

    await waitFor(() => {
      const posts = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((call: unknown[]) => call[0] === "/api/jobs");
      expect(posts).toHaveLength(1);
    }, { timeout: 5000 });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) => call[0] === "/api/jobs") as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      operation: "INSPECT_TEMPLATE",
      workerId: FAHADNAKASH.workerId,
      payload: { templateId: "mixkit-smartphone-promo-596", sourceProjectPath: SOURCE_PATH }
    });
  });

  it("forgets a remembered job that no longer exists for this account (404) instead of polling it forever", async () => {
    seedTheRealStaleDraft();
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [FAHADNAKASH], fetchedAt: "2026-09-13T10:07:30.000Z" } },
      [`/api/jobs/${CANCELLED_JOB_ID}`]: { status: 404, body: { error: { code: "JOB_NOT_FOUND", message: "not found" } } }
    });
    renderWizard();

    await waitFor(() => expect(window.localStorage.getItem(PENDING_JOB_STORAGE_KEY)).toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(inspectButton().disabled).toBe(false), { timeout: 5000 });
  });
});
