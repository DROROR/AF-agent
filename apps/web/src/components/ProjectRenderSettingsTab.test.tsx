// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRenderSettingsTab } from "./ProjectRenderSettingsTab";
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
    hasPreview: true,
    latestPreviewScenePlanId: "s1",
    latestPreviewCapturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function manifestWithCompositions() {
  return {
    ...manifestFixture(),
    compositions: [
      { compositionId: "comp-landscape", aeProjectItemIndex: 3, name: "Landscape Master", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
      { compositionId: "comp-reels", aeProjectItemIndex: 7, name: "Reels Master", widthPx: 1080, heightPx: 1920, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ]
  };
}

/** manifestFixture() itself now carries one real composition (added for ProjectWorkMapTab's human-readable scene picker, video-planning UX simplification 2026-08-31) - this test's own point is specifically the ZERO-compositions case, so it must never rely on the shared fixture's default happening to be empty. */
function manifestWithNoCompositions() {
  return { ...manifestFixture(), compositions: [] };
}

function stubWorkspace(planOverrides: Record<string, unknown> = {}, manifest = manifestWithCompositions()): void {
  stubFetchByUrl({
    ...NO_WORKERS_STATUS,
    [`/api/projects/${PROJECT_ID}/execution-plan/render-outputs`]: { status: 200, body: { plan: planFixture(planOverrides), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(planOverrides), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest } }
  });
}

function renderTab(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectRenderSettingsTab />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

/**
 * Client-handoff phase, section S/N ("Final Outputs / Downloads", "First
 * Preview Player / Image") - placed BEFORE the main describe block below
 * (whose last test switches the shared jsdom document's lang to "he" via
 * renderWithLocale and never resets it) so these tests always run while
 * the locale is still the default "en" - same convention established in
 * MappingAssistantPanel.test.tsx.
 */
describe("ProjectRenderSettingsTab - Final Outputs", () => {
  it("shows the honest empty state when no render artifact exists yet", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithCompositions() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findByText("No renders yet");
  });

  it("lists a real completed artifact with its variant, completed status, and a working download link - never a fake placeholder", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithCompositions() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [renderArtifactFixture({ variant: "LANDSCAPE" })] } }
    });
    renderTab();
    await screen.findByText("Complete");
    screen.getByText("Landscape");

    const downloadLink = screen.getByRole("link", { name: "Download" }) as HTMLAnchorElement;
    expect(downloadLink.getAttribute("href")).toBe(`/api/projects/${PROJECT_ID}/render-artifacts/${renderArtifactFixture().id}/file`);
  });

  it("Preview toggles a real video element with the same authenticated artifact URL - never a fake placeholder", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithCompositions() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [renderArtifactFixture({ variant: "REELS" })] } }
    });
    renderTab();
    await screen.findByRole("button", { name: "Preview" });
    expect(document.querySelector("video")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe(`/api/projects/${PROJECT_ID}/render-artifacts/${renderArtifactFixture().id}/file`);

    fireEvent.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(document.querySelector("video")).toBeNull();
  });
});

describe("ProjectRenderSettingsTab", () => {
  it("shows the honest no-compositions state when the manifest has none", async () => {
    stubWorkspace({}, manifestWithNoCompositions());
    renderTab();
    const titles = await screen.findAllByText("No compositions available");
    expect(titles).toHaveLength(2);
  });

  it("lists only real manifest compositions in the picker - never an arbitrary numeric index field", async () => {
    stubWorkspace();
    renderTab();
    await screen.findAllByText("Landscape master");

    const selects = screen.getAllByLabelText("Master composition") as HTMLSelectElement[];
    const landscapeSelect = selects[0]!;
    const optionLabels = Array.from(landscapeSelect.options).map((option) => option.textContent);
    expect(optionLabels).toContain("Landscape Master (1920×1080)");
    expect(optionLabels).toContain("Reels Master (1080×1920)");
    expect(screen.queryByLabelText(/index/i)).toBeNull();
  });

  it("saves a configuration and shows the configured-at confirmation", async () => {
    const configuredAt = "2026-08-27T00:00:00.000Z";
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan/render-outputs/LANDSCAPE`]: {
        status: 200,
        body: {
          plan: planFixture({
            renderOutputs: {
              LANDSCAPE: {
                manifestCompositionId: "comp-landscape",
                aeProjectItemIndex: 3,
                compositionName: "Landscape Master",
                sourceProjectSha256: SOURCE_SHA,
                renderSettingsTemplateName: "Best Settings",
                outputModuleTemplateName: "H.264 - Match Source",
                configuredAt
              },
              REELS: null
            }
          }),
          sceneTable: []
        }
      },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithCompositions() } }
    });
    renderTab();
    await screen.findAllByText("Landscape master");

    const selects = screen.getAllByLabelText("Master composition") as HTMLSelectElement[];
    fireEvent.change(selects[0]!, { target: { value: "comp-landscape" } });
    const rsTemplateInputs = screen.getAllByLabelText("Render Settings template name");
    fireEvent.change(rsTemplateInputs[0]!, { target: { value: "Best Settings" } });
    const omTemplateInputs = screen.getAllByLabelText("Output Module template name");
    fireEvent.change(omTemplateInputs[0]!, { target: { value: "H.264 - Match Source" } });

    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[0]!);

    await screen.findByText(`Configured ${new Date(configuredAt).toLocaleString()}`);
  });

  it("shows a stale-configuration warning when the configured sourceProjectSha256 no longer matches the current manifest", async () => {
    stubWorkspace({
      renderOutputs: {
        LANDSCAPE: {
          manifestCompositionId: "comp-landscape",
          aeProjectItemIndex: 3,
          compositionName: "Landscape Master",
          sourceProjectSha256: "b".repeat(64),
          renderSettingsTemplateName: "Best Settings",
          outputModuleTemplateName: "H.264 - Match Source",
          configuredAt: new Date().toISOString()
        },
        REELS: null
      }
    });
    renderTab();
    await screen.findByText("This configuration is stale");
  });

  it("disables Inspect Render Capabilities with an honest reason when no worker is available", async () => {
    stubWorkspace({
      renderOutputs: {
        LANDSCAPE: {
          manifestCompositionId: "comp-landscape",
          aeProjectItemIndex: 3,
          compositionName: "Landscape Master",
          sourceProjectSha256: SOURCE_SHA,
          renderSettingsTemplateName: "Best Settings",
          outputModuleTemplateName: "H.264 - Match Source",
          configuredAt: new Date().toISOString()
        },
        REELS: null
      }
    });
    renderTab();
    await screen.findByText("No worker available");
    expect((screen.getByRole("button", { name: "Inspect Render Capabilities" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Render with an honest 'not ready to render yet' reason when no execution session has reached READY_TO_RENDER", async () => {
    stubWorkspace({
      renderOutputs: {
        LANDSCAPE: {
          manifestCompositionId: "comp-landscape",
          aeProjectItemIndex: 3,
          compositionName: "Landscape Master",
          sourceProjectSha256: SOURCE_SHA,
          renderSettingsTemplateName: "Best Settings",
          outputModuleTemplateName: "H.264 - Match Source",
          configuredAt: new Date().toISOString()
        },
        REELS: null
      }
    });
    renderTab();
    await screen.findAllByText("Not ready to render yet");
    expect((screen.getAllByRole("button", { name: "Render" })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Render with an honest 'no worker available' reason when the session's own assigned worker is not currently reachable", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: readyToRenderSession("99999999-9999-9999-9999-999999999999") } },
      [`/api/projects/${PROJECT_ID}/execution-plan/render-outputs`]: {
        status: 200,
        body: {
          plan: planFixture({
            renderOutputs: {
              LANDSCAPE: {
                manifestCompositionId: "comp-landscape",
                aeProjectItemIndex: 3,
                compositionName: "Landscape Master",
                sourceProjectSha256: SOURCE_SHA,
                renderSettingsTemplateName: "Best Settings",
                outputModuleTemplateName: "H.264 - Match Source",
                configuredAt: new Date().toISOString()
              },
              REELS: null
            }
          }),
          sceneTable: []
        }
      },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: {
          plan: planFixture({
            renderOutputs: {
              LANDSCAPE: {
                manifestCompositionId: "comp-landscape",
                aeProjectItemIndex: 3,
                compositionName: "Landscape Master",
                sourceProjectSha256: SOURCE_SHA,
                renderSettingsTemplateName: "Best Settings",
                outputModuleTemplateName: "H.264 - Match Source",
                configuredAt: new Date().toISOString()
              },
              REELS: null
            }
          }),
          sceneTable: []
        }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithCompositions() } }
    });
    renderTab();
    await screen.findAllByText("No worker available");
    expect((screen.getAllByRole("button", { name: "Render" })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("dispatches INSPECT_RENDER_CAPABILITIES when a capable worker is available, and shows the real queued job id", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [workerWithCapabilities(["INSPECT_RENDER_CAPABILITIES"])] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithCompositions() } },
      "/api/jobs": {
        status: 201,
        body: {
          jobId: "66666666-6666-6666-6666-666666666666",
          workerId: "44444444-4444-4444-4444-444444444444",
          operation: "INSPECT_RENDER_CAPABILITIES",
          status: "QUEUED",
          createdAt: new Date().toISOString()
        }
      }
    });
    renderTab();
    const button = await screen.findByRole("button", { name: "Inspect Render Capabilities" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await screen.findByText(/66666666-6666-6666-6666-666666666666/);
  });

  it("dispatches RENDER for a configured, non-stale variant when a capable worker is available", async () => {
    const workerId = "44444444-4444-4444-4444-444444444444";
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [workerWithCapabilities(["RENDER"])] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: readyToRenderSession(workerId) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: {
          plan: planFixture({
            renderOutputs: {
              LANDSCAPE: {
                manifestCompositionId: "comp-landscape",
                aeProjectItemIndex: 3,
                compositionName: "Landscape Master",
                sourceProjectSha256: SOURCE_SHA,
                renderSettingsTemplateName: "Best Settings",
                outputModuleTemplateName: "H.264 - Match Source",
                configuredAt: new Date().toISOString()
              },
              REELS: null
            }
          }),
          sceneTable: []
        }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithCompositions() } },
      "/api/jobs": {
        status: 201,
        body: {
          jobId: "77777777-7777-7777-7777-777777777777",
          workerId: "44444444-4444-4444-4444-444444444444",
          operation: "RENDER",
          status: "QUEUED",
          createdAt: new Date().toISOString()
        }
      }
    });
    renderTab();
    await screen.findAllByRole("button", { name: "Render" });
    await waitFor(() => expect((screen.getAllByRole("button", { name: "Render" })[0] as HTMLButtonElement).disabled).toBe(false));
    const renderButtons = screen.getAllByRole("button", { name: "Render" });
    fireEvent.click(renderButtons[0]!);
    await screen.findByText(/77777777-7777-7777-7777-777777777777/);
  });

  it("renders in Hebrew when the active locale is he - real translated strings, not English fallback text", async () => {
    stubWorkspace({}, manifestWithNoCompositions());
    renderWithLocale(
      <DashboardStatusProvider>
        <ProjectWorkspaceProvider projectId={PROJECT_ID}>
          <ProjectRenderSettingsTab />
        </ProjectWorkspaceProvider>
      </DashboardStatusProvider>,
      { locale: "he" }
    );
    const titles = await screen.findAllByText("אין קומפוזיציות זמינות");
    expect(titles).toHaveLength(2);
  });
});
