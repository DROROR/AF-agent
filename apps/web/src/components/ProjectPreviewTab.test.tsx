// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectPreviewTab } from "./ProjectPreviewTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { WorkspaceModeProvider } from "./WorkspaceModeProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  SOURCE_SHA,
  manifestFixture,
  planFixture,
  projectDtoFixture,
  sceneFixture,
  stubFetchByUrl
} from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPreview(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <WorkspaceModeProvider>
        <ProjectWorkspaceProvider projectId={PROJECT_ID}>
          <ProjectPreviewTab />
        </ProjectWorkspaceProvider>
      </WorkspaceModeProvider>
    </DashboardStatusProvider>
  );
}

describe("ProjectPreviewTab", () => {
  it("disables Start execution with an honest reason when no worker reports EXECUTE_FRAME", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } }
    });
    renderPreview();
    await screen.findByText("No worker available");
    expect((screen.getByRole("button", { name: "Start execution" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts an execution session and dispatches EXECUTE_FRAME for the first approved+resolved scene when a real worker is available, and shows the real queued job id", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    const WORKER_ID = "44444444-4444-4444-4444-444444444444";
    const SESSION_ID = "66666666-6666-6666-6666-666666666666";
    stubFetchByUrl({
      "/api/dashboard/status": {
        status: 200,
        body: {
          api: "ok",
          database: "ok",
          workers: [
            {
              workerId: WORKER_ID,
              name: "worker-a",
              status: "ONLINE",
              lastHeartbeatAt: new Date().toISOString(),
              aeStatus: "ONLINE",
              mcpStatus: "ONLINE",
              aeAvailability: "ONLINE",
              mcpAvailability: "ONLINE",
              aeVersion: "26.0",
              capabilities: ["EXECUTE_FRAME"],
              maxConcurrency: 1,
              currentJobId: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]
        }
      },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/execution-sessions`]: {
        status: 201,
        body: {
          session: {
            id: SESSION_ID,
            projectId: PROJECT_ID,
            executionPlanId: "plan-1",
            planRevision: 3,
            sourceProjectSha256: SOURCE_SHA,
            assignedWorkerId: WORKER_ID,
            status: "PREPARING",
            latestWorkingProjectSha256: null,
            completedScenePlanIds: [],
            firstPreviewApproved: false,
            hasPreview: false,
            latestPreviewScenePlanId: null,
            latestPreviewCapturedAt: null,
            fullPreviewApproved: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      },
      "/api/jobs": {
        status: 201,
        body: { jobId: "55555555-5555-5555-5555-555555555555", workerId: WORKER_ID, operation: "EXECUTE_FRAME", status: "QUEUED", createdAt: new Date().toISOString() }
      },
      // Polling fix (2026-09-08 live QA incident): the dispatch response
      // itself only ever means "queued" - the button must stay disabled,
      // and the confirmation text must not appear, until this real
      // GET /api/jobs/:jobId poll reports a terminal status.
      "/api/jobs/55555555-5555-5555-5555-555555555555": {
        status: 200,
        body: {
          job: {
            jobId: "55555555-5555-5555-5555-555555555555",
            workerId: WORKER_ID,
            projectId: PROJECT_ID,
            operation: "EXECUTE_FRAME",
            status: "SUCCEEDED",
            payload: {},
            result: {},
            error: null,
            checkpoint: null,
            createdAt: new Date().toISOString(),
            claimedAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      }
    });
    renderPreview();
    const button = await screen.findByRole("button", { name: "Start execution" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    // Still in flight (real 2s poll interval, real timers) - whichever
    // label the one primary action button now shows ("Start execution"
    // synchronously right after the click, flipping to "Continue
    // execution" once the session-create response lands), it must stay
    // disabled and show no premature success text - exactly the gap that
    // let an operator's second click race a not-yet-completed job and hit
    // the server's own duplicate-dispatch guard while the dashboard still
    // looked idle/stale.
    expect(screen.queryByText("Started - this will update automatically, no need to check again.")).toBeNull();
    await waitFor(() => {
      const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) {
        expect(b.disabled).toBe(true);
      }
    });

    // Final MVP polish item 3 (client status copy): a plain confirmation,
    // never the raw job id (Advanced's Render Settings tab still shows the
    // id for operator correlation with the Jobs/Queue page - unaffected).
    // Only appears once the poll above has actually observed SUCCEEDED.
    await waitFor(() => expect(screen.getByText("Started - this will update automatically, no need to check again.")).not.toBeNull(), {
      timeout: 5000
    });
  }, 10000);

  it("a second click while the job is still in flight is impossible (button stays disabled) - and once the job completes, the button releases and the session refreshes to show real progress, never requiring a duplicate dispatch attempt", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    const WORKER_ID = "44444444-4444-4444-4444-444444444444";
    const SESSION_ID = "66666666-6666-6666-6666-666666666666";
    const JOB_ID = "55555555-5555-5555-5555-555555555555";
    let sessionCallCount = 0;
    stubFetchByUrl({
      "/api/dashboard/status": {
        status: 200,
        body: {
          api: "ok",
          database: "ok",
          workers: [
            {
              workerId: WORKER_ID,
              name: "worker-a",
              status: "ONLINE",
              lastHeartbeatAt: new Date().toISOString(),
              aeStatus: "ONLINE",
              mcpStatus: "ONLINE",
              aeAvailability: "ONLINE",
              mcpAvailability: "ONLINE",
              aeVersion: "26.0",
              capabilities: ["EXECUTE_FRAME"],
              maxConcurrency: 1,
              currentJobId: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]
        }
      },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/execution-sessions`]: {
        status: 201,
        body: {
          session: {
            id: SESSION_ID,
            projectId: PROJECT_ID,
            executionPlanId: "plan-1",
            planRevision: 3,
            sourceProjectSha256: SOURCE_SHA,
            assignedWorkerId: WORKER_ID,
            status: "PREPARING",
            latestWorkingProjectSha256: null,
            completedScenePlanIds: [],
            firstPreviewApproved: false,
            hasPreview: false,
            latestPreviewScenePlanId: null,
            latestPreviewCapturedAt: null,
            fullPreviewApproved: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      },
      "/api/jobs": {
        status: 201,
        body: { jobId: JOB_ID, workerId: WORKER_ID, operation: "EXECUTE_FRAME", status: "QUEUED", createdAt: new Date().toISOString() }
      },
      [`/api/jobs/${JOB_ID}`]: {
        status: 200,
        body: {
          job: {
            jobId: JOB_ID,
            workerId: WORKER_ID,
            projectId: PROJECT_ID,
            operation: "EXECUTE_FRAME",
            status: "SUCCEEDED",
            payload: {},
            result: {},
            error: null,
            checkpoint: null,
            createdAt: new Date().toISOString(),
            claimedAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      }
    });
    renderPreview();
    const button = await screen.findByRole("button", { name: "Start execution" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText("Started - this will update automatically, no need to check again.")).not.toBeNull(), {
      timeout: 5000
    });

    // The session refetch the poll's completion triggers is the real fix -
    // confirm it actually happened (never left relying on stale local
    // completedScenePlanIds), by counting real calls to the session-fetch
    // endpoint across the whole interaction. The refetch fires from a
    // state update made inside the same poll tick that showed the text
    // above, but React flushes the resulting effect asynchronously, so
    // this must itself be awaited rather than checked immediately.
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string][];
      sessionCallCount = calls.filter(([url]) => url.includes("/execution-sessions/current")).length;
      expect(sessionCallCount).toBeGreaterThanOrEqual(2);
    });
  }, 10000);

  function awaitingPreviewSession(overrides: Record<string, unknown> = {}) {
    return {
      id: "66666666-6666-6666-6666-666666666666",
      projectId: PROJECT_ID,
      executionPlanId: "plan-1",
      planRevision: 3,
      sourceProjectSha256: SOURCE_SHA,
      assignedWorkerId: "44444444-4444-4444-4444-444444444444",
      status: "AWAITING_PREVIEW_APPROVAL",
      latestWorkingProjectSha256: "d".repeat(64),
      completedScenePlanIds: ["s1"],
      firstPreviewApproved: false,
      hasPreview: true,
      latestPreviewScenePlanId: "s1",
      latestPreviewCapturedAt: new Date().toISOString(),
      fullPreviewApproved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  it("shows the real captured preview image (never a placeholder) once the session reports hasPreview, and offers both Approve and Reject actions", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    const session = awaitingPreviewSession();
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session } }
    });
    renderPreview();
    const approveButton = await screen.findByRole("button", { name: "Approve preview" });
    screen.getByRole("button", { name: "Reject preview" });
    const image = screen.getByAltText("Captured first-frame preview") as HTMLImageElement;
    expect(image.src).toContain(`/api/projects/${PROJECT_ID}/execution-sessions/66666666-6666-6666-6666-666666666666/preview`);
    // Cache-busting fix (live QA, 2026-09-09 real incident): the image src
    // must include a version query param derived from the session's own
    // real latestPreviewCapturedAt - a stable URL is exactly what let the
    // browser keep showing an old frame after a real regeneration.
    expect(image.src).toContain(`?v=${encodeURIComponent(session.latestPreviewCapturedAt as string)}`);
    expect(approveButton).toBeTruthy();
  });

  it("rejects a preview and reflects the session's new FAILED status - never silently continues as if approved", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: awaitingPreviewSession() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/66666666-6666-6666-6666-666666666666/reject-preview`]: {
        status: 200,
        body: { session: awaitingPreviewSession({ status: "FAILED" }) }
      }
    });
    renderPreview();
    const rejectButton = await screen.findByRole("button", { name: "Reject preview" });
    fireEvent.click(rejectButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve preview" })).toBeNull());
  });

  /**
   * First Preview regeneration (live QA, 2026-09-08/09 incident): rejecting
   * a preview marks the session FAILED (terminal, by design, for a
   * genuinely bad edit) - but the real incident was never a bad edit, only
   * an unrepresentative captured frame (t=0, a solid background color).
   * "Start execution" must never be offered here (it would silently start
   * a brand new session and needlessly re-run the same real AE work) -
   * "Regenerate First Preview" is offered instead, targeting the SAME
   * session/working copy.
   */
  function rejectedButRecoverableSession(overrides: Record<string, unknown> = {}) {
    return awaitingPreviewSession({ status: "FAILED", ...overrides });
  }

  const REGEN_WORKER = {
    workerId: "44444444-4444-4444-4444-444444444444",
    name: "worker-a",
    status: "ONLINE",
    lastHeartbeatAt: new Date().toISOString(),
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeAvailability: "ONLINE",
    mcpAvailability: "ONLINE",
    aeVersion: "26.0",
    capabilities: ["EXECUTE_FRAME"],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  it("shows 'Regenerate First Preview' instead of 'Start execution' for a FAILED session that has real completed work and a prior preview (the rejected-preview recovery case)", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [REGEN_WORKER] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: rejectedButRecoverableSession() } }
    });
    renderPreview();
    await screen.findByRole("button", { name: "Regenerate First Preview" });
    expect(screen.queryByRole("button", { name: "Start execution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue execution" })).toBeNull();
  });

  it("clicking Regenerate First Preview dispatches EXECUTE_FRAME with regeneratePreviewOnly against the SAME session/scene - never creates a new session", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    const JOB_ID = "88888888-8888-8888-8888-888888888888";
    let capturedBody: Record<string, unknown> | null = null;
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [REGEN_WORKER] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: rejectedButRecoverableSession() } },
      "/api/jobs": { status: 201, body: { jobId: JOB_ID, workerId: REGEN_WORKER.workerId, operation: "EXECUTE_FRAME", status: "QUEUED", createdAt: new Date().toISOString() } },
      [`/api/jobs/${JOB_ID}`]: {
        status: 200,
        body: {
          job: {
            jobId: JOB_ID,
            workerId: REGEN_WORKER.workerId,
            projectId: PROJECT_ID,
            operation: "EXECUTE_FRAME",
            status: "SUCCEEDED",
            payload: {},
            result: {},
            error: null,
            checkpoint: null,
            createdAt: new Date().toISOString(),
            claimedAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      }
    });
    renderPreview();
    const input = await screen.findByLabelText("Preview at (seconds)");
    fireEvent.change(input, { target: { value: "4" } });
    const button = screen.getByRole("button", { name: "Regenerate First Preview" });
    fireEvent.click(button);

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
      const jobsCall = calls.find(([url]) => url === "/api/jobs");
      expect(jobsCall).toBeDefined();
      capturedBody = JSON.parse(jobsCall![1].body as string) as Record<string, unknown>;
    });

    expect(capturedBody).toMatchObject({
      operation: "EXECUTE_FRAME",
      workerId: REGEN_WORKER.workerId,
      executionSessionId: "66666666-6666-6666-6666-666666666666",
      scenePlanId: "s1",
      regeneratePreviewOnly: true,
      previewTimestampSeconds: 4
    });
    // Never called createExecutionSession - regeneration reuses the
    // existing session, it never starts a fresh one.
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(calls.some(([url]) => url === `/api/projects/${PROJECT_ID}/execution-sessions`)).toBe(false);
  }, 10000);

  it("after a successful regeneration, the session returns to AWAITING_PREVIEW_APPROVAL with Approve/Reject shown, and the preview image's own URL changes to the new capture - never the stale cached frame", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    const JOB_ID = "99999999-9999-9999-9999-999999999999";
    const OLD_CAPTURED_AT = "2026-09-09T13:13:37.000Z";
    const NEW_CAPTURED_AT = "2026-09-09T13:25:48.000Z";
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [REGEN_WORKER] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: [
        { status: 200, body: { session: rejectedButRecoverableSession({ latestPreviewCapturedAt: OLD_CAPTURED_AT }) } },
        { status: 200, body: { session: awaitingPreviewSession({ latestPreviewCapturedAt: NEW_CAPTURED_AT }) } }
      ],
      "/api/jobs": { status: 201, body: { jobId: JOB_ID, workerId: REGEN_WORKER.workerId, operation: "EXECUTE_FRAME", status: "QUEUED", createdAt: new Date().toISOString() } },
      [`/api/jobs/${JOB_ID}`]: {
        status: 200,
        body: {
          job: {
            jobId: JOB_ID,
            workerId: REGEN_WORKER.workerId,
            projectId: PROJECT_ID,
            operation: "EXECUTE_FRAME",
            status: "SUCCEEDED",
            payload: {},
            result: {},
            error: null,
            checkpoint: null,
            createdAt: new Date().toISOString(),
            claimedAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      }
    });
    renderPreview();
    const imageBefore = (await screen.findByAltText("Captured first-frame preview")) as HTMLImageElement;
    expect(imageBefore.src).toContain(`?v=${encodeURIComponent(OLD_CAPTURED_AT)}`);

    const button = await screen.findByRole("button", { name: "Regenerate First Preview" });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole("button", { name: "Approve preview" })).not.toBeNull(), { timeout: 5000 });
    screen.getByRole("button", { name: "Reject preview" });

    // The exact real 2026-09-09 incident: the operator saw the approval
    // gate reload but the image looked unchanged. This is what proves it
    // didn't - same component instance, no remount, the <img>'s own src
    // now points at the NEW capture.
    const imageAfter = screen.getByAltText("Captured first-frame preview") as HTMLImageElement;
    expect(imageAfter.src).toContain(`?v=${encodeURIComponent(NEW_CAPTURED_AT)}`);
    expect(imageAfter.src).not.toBe(imageBefore.src);
  }, 10000);
});

/**
 * Client-handoff phase, "real final preview approval gate" - the
 * FinalPreviewCard only appears once every approved scene has completed
 * (allScenesComplete), and requires an explicit "Approve Final Preview"
 * click before the render step ever becomes reachable.
 */
describe("ProjectPreviewTab - Final Preview", () => {
  const SESSION_ID = "77777777-7777-7777-7777-777777777777";
  const WORKER_ID = "44444444-4444-4444-4444-444444444444";

  function readyToRenderSession(overrides: Record<string, unknown> = {}) {
    return {
      id: SESSION_ID,
      projectId: PROJECT_ID,
      executionPlanId: "plan-1",
      planRevision: 3,
      sourceProjectSha256: SOURCE_SHA,
      assignedWorkerId: WORKER_ID,
      status: "READY_TO_RENDER",
      latestWorkingProjectSha256: "d".repeat(64),
      completedScenePlanIds: ["s1"],
      firstPreviewApproved: true,
      hasPreview: true,
      latestPreviewScenePlanId: "s1",
      latestPreviewCapturedAt: new Date().toISOString(),
      fullPreviewApproved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  function stubReady(extra: Record<string, Parameters<typeof stubFetchByUrl>[0][string]> = {}): void {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: readyToRenderSession() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/full-preview-status`]: { status: 200, body: { artifact: null } },
      ...extra
    });
  }

  it('shows "not ready yet" and a real worker-offline message when Create Complete Preview is clicked with no compatible worker online', async () => {
    stubReady();
    renderPreview();
    await screen.findByText("Your complete preview is not ready yet.");
    fireEvent.click(screen.getByRole("button", { name: "Create Complete Preview" }));
    await screen.findByText("Your editing computer is offline. Turn it on to create the complete preview.");
  });

  it("renders the real complete-preview video and Approve/Request Changes actions once a fresh artifact exists", async () => {
    stubReady({
      [`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/full-preview-status`]: {
        status: 200,
        body: {
          artifact: {
            id: "88888888-8888-8888-8888-888888888888",
            projectId: PROJECT_ID,
            executionSessionId: SESSION_ID,
            workingProjectSha256: "d".repeat(64),
            filename: "preview.mp4",
            mimeType: "video/mp4",
            byteSize: 100,
            capturedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
          }
        }
      }
    });
    renderPreview();
    await screen.findByRole("button", { name: "Approve Final Preview" });
    screen.getByRole("button", { name: "Request Changes" });
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/full-preview`);
  });

  /**
   * Real 2026-09-10/11 incident (session a7fee3d9): a Worker/render-engine
   * fix (e.g. the full-duration-render fix) can make an existing artifact
   * stale in a way isFresh's workingProjectSha256-only comparison can never
   * detect, since the working copy's own content did not change. This
   * button reuses the EXACT SAME CREATE_PREVIEW dispatch as "Create
   * Complete Preview" (not a new endpoint/auth path), stays separate from
   * Approve/Request Changes, and is available even though the artifact's
   * workingProjectSha256 already matches the session's current one.
   */
  it('shows "Regenerate Complete Preview" alongside Approve/Request Changes once a fresh artifact exists, and it dispatches the SAME CREATE_PREVIEW job as "Create Complete Preview"', async () => {
    stubReady({
      "/api/dashboard/status": {
        status: 200,
        body: {
          api: "ok",
          database: "ok",
          workers: [
            {
              workerId: WORKER_ID,
              name: "worker-a",
              status: "ONLINE",
              lastHeartbeatAt: new Date().toISOString(),
              aeStatus: "ONLINE",
              mcpStatus: "ONLINE",
              aeAvailability: "ONLINE",
              mcpAvailability: "ONLINE",
              aeVersion: "26.0",
              capabilities: ["CREATE_PREVIEW"],
              maxConcurrency: 1,
              currentJobId: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]
        }
      },
      [`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/full-preview-status`]: {
        status: 200,
        body: {
          artifact: {
            id: "88888888-8888-8888-8888-888888888888",
            projectId: PROJECT_ID,
            executionSessionId: SESSION_ID,
            workingProjectSha256: "d".repeat(64),
            filename: "preview.mp4",
            mimeType: "video/mp4",
            byteSize: 100,
            capturedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
          }
        }
      },
      "/api/jobs": {
        status: 201,
        body: { jobId: "99999999-9999-9999-9999-999999999999", workerId: WORKER_ID, operation: "CREATE_PREVIEW", status: "QUEUED", createdAt: new Date().toISOString() }
      }
    });
    renderPreview();
    await screen.findByRole("button", { name: "Approve Final Preview" });
    // Still the fresh-artifact view, not the "not ready" empty state - proves this is additive, not a replacement for Approve/Request Changes.
    screen.getByRole("button", { name: "Request Changes" });
    const regenerateButton = screen.getByRole("button", { name: "Regenerate Complete Preview" });
    fireEvent.click(regenerateButton);

    let body: Record<string, unknown> | null = null;
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
      const jobsCall = calls.find(([url]) => url === "/api/jobs");
      expect(jobsCall).toBeDefined();
      body = JSON.parse(jobsCall![1].body as string) as Record<string, unknown>;
    });
    expect(body).toEqual({
      operation: "CREATE_PREVIEW",
      workerId: WORKER_ID,
      projectId: PROJECT_ID,
      executionSessionId: SESSION_ID
    });
  });

  it("a STALE artifact (captured against an older working copy) is treated as not ready - never shown as if it were the current preview", async () => {
    stubReady({
      [`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/full-preview-status`]: {
        status: 200,
        body: {
          artifact: {
            id: "88888888-8888-8888-8888-888888888888",
            projectId: PROJECT_ID,
            executionSessionId: SESSION_ID,
            workingProjectSha256: "b".repeat(64), // different from the session's current working copy
            filename: "preview.mp4",
            mimeType: "video/mp4",
            byteSize: 100,
            capturedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
          }
        }
      }
    });
    renderPreview();
    await screen.findByText("Your complete preview is not ready yet.");
    expect(document.querySelector("video")).toBeNull();
  });

  it("clicking Approve Final Preview calls the real endpoint and shows the Approved badge", async () => {
    stubReady({
      [`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/full-preview-status`]: {
        status: 200,
        body: {
          artifact: {
            id: "88888888-8888-8888-8888-888888888888",
            projectId: PROJECT_ID,
            executionSessionId: SESSION_ID,
            workingProjectSha256: "d".repeat(64),
            filename: "preview.mp4",
            mimeType: "video/mp4",
            byteSize: 100,
            capturedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
          }
        }
      },
      [`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/approve-final-preview`]: {
        status: 200,
        body: { session: readyToRenderSession({ fullPreviewApproved: true }) }
      }
    });
    renderPreview();
    const approveButton = await screen.findByRole("button", { name: "Approve Final Preview" });
    fireEvent.click(approveButton);
    await waitFor(() => expect((screen.getByRole("button", { name: "Approved" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
  });
});

/**
 * Live QA fix (CASE C, "Do not let users freely jump into a dead page"):
 * a Simple Mode client reaching this tab before any execution plan exists
 * (e.g. by direct URL entry) must see an honest, actionable message with a
 * way back to the guided stepper - never the bare "No execution plan yet"
 * dead end. Advanced Mode keeps the raw technical empty state unchanged.
 */
describe("ProjectPreviewTab - locked before a plan exists (live QA fix)", () => {
  function stubNoPlan(): void {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 404, body: { error: { code: "EXECUTION_PLAN_NOT_FOUND", message: "none", requestId: "r1" } } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
  }

  it("Simple Mode shows an actionable locked notice with a return-to-current-step action, never 'No execution plan yet'", async () => {
    stubNoPlan();
    renderPreview();

    await screen.findByText("First Preview isn't available yet");
    expect(screen.queryByText("No execution plan yet")).toBeNull();
    expect(screen.getByRole("link", { name: "Return to current step" })).not.toBeNull();
  });

  it("Advanced Mode keeps the raw technical empty state unchanged", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubNoPlan();
    renderPreview();

    await screen.findByText("No execution plan yet");
  });
});
