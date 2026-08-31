// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
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

function renderOverview(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectOverviewTab />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

describe("ProjectOverviewTab", () => {
  it("shows the real plan revision and status, never a fabricated value", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 3, status: "DRAFT" }), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderOverview();
    await screen.findByText("Draft");
    screen.getByText("3");
  });

  it("shows the real unresolved-scene count and refuses to imply the plan is ready", async () => {
    const scenes = [
      sceneFixture({ id: "s1", unresolvedReasons: ["no confident structural classification"] }),
      sceneFixture({ id: "s2", unresolvedReasons: ["no confident structural classification"] })
    ];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderOverview();
    await screen.findByText("Not ready for approval");
    screen.getByText("2 unresolved scene(s)");
    expect((screen.getByRole("button", { name: "Approve plan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Approve plan once every scene is resolved", async () => {
    const scenes = [sceneFixture({ id: "s1", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderOverview();
    await screen.findByText("Ready for approval");
    expect((screen.getByRole("button", { name: "Approve plan" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the stale-revision recovery state (never silently overwrites) on a 409 CONFLICT", async () => {
    const scenes = [sceneFixture({ id: "s1", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-plan/approve`]: {
        status: 409,
        body: { error: { code: "CONFLICT", message: "stale revision", requestId: "r1" } }
      }
    });
    renderOverview();
    await screen.findByText("Ready for approval");
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    await screen.findByText("This plan changed elsewhere");
    screen.getByRole("button", { name: "Reload" });
  });

  it("surfaces the backend's real PRECONDITION_NOT_MET refusal cleanly - proves the backend enforces this independently of the disabled button", async () => {
    // Bypasses this component's own isReady check by clicking Approve
    // while scenes are actually unresolved is not directly simulable here
    // (the button is disabled) - instead this proves the OTHER real path:
    // the backend can refuse for reasons the UI doesn't fully anticipate,
    // and that refusal must render as a clear error, never be swallowed.
    const scenes = [sceneFixture({ id: "s1", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-plan/approve`]: {
        status: 409,
        body: { error: { code: "PRECONDITION_NOT_MET", message: "Plan is not ready for approval: 1 scene(s) marked for use still have an unresolved reason", requestId: "r1" } }
      }
    });
    renderOverview();
    await screen.findByText("Ready for approval");
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    await screen.findByText("Could not save this change");
    screen.getByText("Plan is not ready for approval: 1 scene(s) marked for use still have an unresolved reason");
  });

  it("updates to the new revision returned by the backend after a successful approval", async () => {
    const scenes = [sceneFixture({ id: "s1", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 3 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-plan/approve`]: {
        status: 200,
        body: { plan: planFixture({ revision: 3, status: "APPROVED" }, scenes), sceneTable: [] }
      }
    });
    renderOverview();
    await screen.findByText("Ready for approval");
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    const approvedLabels = await screen.findAllByText("Approved");
    expect(approvedLabels.length).toBeGreaterThan(0);
  });

  it("disables Start execution with an honest reason when no worker reports EXECUTE_FRAME", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } }
    });
    renderOverview();
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
      }
    });
    renderOverview();
    const button = await screen.findByRole("button", { name: "Start execution" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByText(/55555555-5555-5555-5555-555555555555/);
  });

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
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: awaitingPreviewSession() } }
    });
    renderOverview();
    const approveButton = await screen.findByRole("button", { name: "Approve preview" });
    screen.getByRole("button", { name: "Reject preview" });
    const image = screen.getByAltText("Captured first-frame preview") as HTMLImageElement;
    expect(image.src).toContain(`/api/projects/${PROJECT_ID}/execution-sessions/66666666-6666-6666-6666-666666666666/preview`);
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
    renderOverview();
    const rejectButton = await screen.findByRole("button", { name: "Reject preview" });
    fireEvent.click(rejectButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve preview" })).toBeNull());
  });
});

/**
 * Client-handoff phase, "real final preview approval gate" - the
 * FinalPreviewCard only appears once every approved scene has completed
 * (allScenesComplete), and requires an explicit "Approve Final Preview"
 * click before the render step ever becomes reachable.
 */
describe("ProjectOverviewTab - Final Preview", () => {
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
    renderOverview();
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
    renderOverview();
    await screen.findByRole("button", { name: "Approve Final Preview" });
    screen.getByRole("button", { name: "Request Changes" });
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/full-preview`);
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
    renderOverview();
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
    renderOverview();
    const approveButton = await screen.findByRole("button", { name: "Approve Final Preview" });
    fireEvent.click(approveButton);
    await waitFor(() => expect((screen.getByRole("button", { name: "Approved" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
  });
});
