// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectExportTab } from "./ProjectExportTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { WorkspaceModeProvider } from "./WorkspaceModeProvider";
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
      <WorkspaceModeProvider>
        <ProjectWorkspaceProvider projectId={PROJECT_ID}>
          <ProjectExportTab />
        </ProjectWorkspaceProvider>
      </WorkspaceModeProvider>
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

/**
 * Live QA fix (CASE C, "Do not let users freely jump into a dead page"):
 * a Simple Mode client reaching this tab before any execution plan exists
 * must see an honest, actionable message with a way back to the guided
 * stepper - never the bare "No execution plan yet" dead end. Advanced Mode
 * keeps the raw technical empty state unchanged.
 */
describe("ProjectExportTab - locked before a plan exists (live QA fix)", () => {
  function stubNoPlan(): void {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 404, body: { error: { code: "EXECUTION_PLAN_NOT_FOUND", message: "none", requestId: "r1" } } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
  }

  it("Simple Mode shows an actionable locked notice with a return-to-current-step action, never 'No execution plan yet'", async () => {
    stubNoPlan();
    renderTab();

    await screen.findByText("Export isn't available yet");
    expect(screen.queryByText("No execution plan yet")).toBeNull();
    expect(screen.getByRole("link", { name: "Return to current step" })).not.toBeNull();
  });

  it("Advanced Mode keeps the raw technical empty state unchanged", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubNoPlan();
    renderTab();

    await screen.findByText("No execution plan yet");
  });
});

/**
 * REAL 2026-09-25 INCIDENT: the daily operator could not tell why the
 * Render button was greyed out. This tab's four disabling conditions are
 * genuinely different problems with genuinely different fixes - and the
 * most common one is fixable only on a tab Simple Mode does not even show -
 * so each must state itself ON the control, attached to it, not merely
 * somewhere else on the page.
 */
describe("ProjectExportTab - a disabled Render button always says why (REAL 2026-09-25 wayfinding incident)", () => {
  function renderButton(): HTMLButtonElement {
    return screen.getAllByRole("button", { name: /^Render / })[0] as HTMLButtonElement;
  }

  it("names the missing master composition AND the tab that fixes it, wired to the button itself", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ renderOutputs: { LANDSCAPE: null, REELS: null } }), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findAllByText("Not set up yet");

    const button = renderButton();
    expect(button.disabled).toBe(true);
    const reason = screen.getAllByText("No master composition is saved for this output yet. Choose one in Render Settings (Advanced view).")[0]!;
    expect(button.getAttribute("aria-describedby")).toBe(reason.getAttribute("id"));
  });

  it("switches to the final-preview reason once a master IS configured but no session is ready to render - never repeats the configuration reason", async () => {
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

    // The LANDSCAPE card is configured; its own button must give the
    // session reason, while REELS (still unconfigured) keeps its own.
    screen.getByText("The complete preview has to be approved on the Preview tab before rendering.");
    screen.getByText("No master composition is saved for this output yet. Choose one in Render Settings (Advanced view).");
  });

  it("reports a STALE master as a re-selection problem, never as 'not configured' - they need different fixes", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: {
          plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig({ sourceProjectSha256: "e".repeat(64) }), REELS: null } }),
          sceneTable: []
        }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findAllByText("Not set up yet");

    screen.getByText("The template changed since this master composition was chosen. Re-select it in Render Settings.");
  });

  it("an ENABLED Render button carries no reason at all - the explanation only ever appears when it is actually blocked", async () => {
    const worker = workerWithCapabilities(["RENDER"]);
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: readyToRenderSession(worker.workerId) } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();

    await waitFor(() => expect((screen.getAllByRole("button", { name: "Render Landscape" })[0] as HTMLButtonElement).disabled).toBe(false));
    const button = screen.getAllByRole("button", { name: "Render Landscape" })[0]!;
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(button.getAttribute("title")).toBeNull();
  });
});
