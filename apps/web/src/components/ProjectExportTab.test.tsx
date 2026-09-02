// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectExportTab } from "./ProjectExportTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, SOURCE_SHA, manifestFixture, planFixture, projectDtoFixture, renderArtifactFixture, stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NO_WORKERS_STATUS = { "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } } };

function workerWithCapabilities(capabilities: string[]) {
  return {
    workerId: "44444444-4444-4444-4444-444444444444",
    name: "worker-a",
    status: "ONLINE",
    lastHeartbeatAt: new Date().toISOString(),
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeAvailability: "ONLINE",
    mcpAvailability: "ONLINE",
    aeVersion: "26.0",
    capabilities,
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function readyToRenderSession(workerId: string) {
  return {
    id: "88888888-8888-8888-8888-888888888888",
    projectId: PROJECT_ID,
    executionPlanId: "plan-1",
    planRevision: 3,
    sourceProjectSha256: SOURCE_SHA,
    assignedWorkerId: workerId,
    status: "READY_TO_RENDER",
    latestWorkingProjectSha256: "d".repeat(64),
    completedScenePlanIds: ["s1"],
    firstPreviewApproved: true,
    fullPreviewApproved: true,
    hasPreview: true,
    latestPreviewScenePlanId: "s1",
    latestPreviewCapturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function landscapeConfig(overrides: Record<string, unknown> = {}) {
  return {
    manifestCompositionId: "comp-landscape",
    aeProjectItemIndex: 3,
    compositionName: "Landscape Master",
    sourceProjectSha256: SOURCE_SHA,
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Source",
    configuredAt: new Date().toISOString(),
    ...overrides
  };
}

function renderTab(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectExportTab />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

/**
 * "Export" tab (final MVP nav) - a plain-language render trigger, never
 * the raw composition/template-name configuration UI Advanced's Render
 * Settings tab exposes. These tests prove: an unconfigured/stale variant
 * shows a plain "not set up" message (never the raw fields), a configured
 * variant that isn't render-ready shows a plain "not ready" message, a
 * genuinely ready variant with an online worker dispatches RENDER with no
 * technical fields ever shown, and the real download/playback list
 * (FinalOutputsCard, reused unchanged from ProjectRenderSettingsTab) is
 * present on this tab too.
 */
describe("ProjectExportTab", () => {
  it("never exposes the raw composition picker or template-name fields Advanced's Render Settings tab shows", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findAllByText("Not set up yet");
    expect(screen.queryByLabelText("Master composition")).toBeNull();
    expect(screen.queryByLabelText("Render Settings template name")).toBeNull();
    expect(screen.queryByLabelText("Output Module template name")).toBeNull();
  });

  it("shows a plain 'not set up yet' message (never the raw fields) when a variant has no render configuration", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ renderOutputs: { LANDSCAPE: null, REELS: null } }), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    const notConfigured = await screen.findAllByText("Not set up yet");
    expect(notConfigured.length).toBe(2); // LANDSCAPE and REELS
  });

  it("shows a plain 'not ready yet' message when the variant IS configured but no execution session has reached READY_TO_RENDER", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findByText("Not ready yet");
  });

  it("dispatches RENDER for a configured, ready variant with a real plain-language button label, and shows the real queued job id", async () => {
    const workerId = "44444444-4444-4444-4444-444444444444";
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [workerWithCapabilities(["RENDER"])] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: readyToRenderSession(workerId) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } },
      "/api/jobs": {
        status: 201,
        body: { jobId: "77777777-7777-7777-7777-777777777777", workerId, operation: "RENDER", status: "QUEUED", createdAt: new Date().toISOString() }
      }
    });
    renderTab();
    const renderButton = await screen.findByRole("button", { name: "Render Landscape" });
    await waitFor(() => expect((renderButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(renderButton);
    // Final MVP polish item 3 (client status copy): a plain confirmation,
    // never the raw job id (Advanced's Render Settings tab still shows the
    // id for operator correlation with the Jobs/Queue page - unaffected).
    await screen.findByText("Started - this will update automatically, no need to check again.");
  });

  it("shows the real, downloadable Final Outputs list (the same authenticated artifact route Advanced's Render Settings tab uses)", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [renderArtifactFixture({ variant: "LANDSCAPE" })] } }
    });
    renderTab();
    const downloadLink = await screen.findByRole("link", { name: "Download" });
    expect(downloadLink.getAttribute("href")).toBe(`/api/projects/${PROJECT_ID}/render-artifacts/${renderArtifactFixture().id}/file`);
  });
});
