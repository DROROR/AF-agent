// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRenderSettingsTab } from "./ProjectRenderSettingsTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, SOURCE_SHA, manifestFixture, planFixture, projectDtoFixture, stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function manifestWithCompositions() {
  return {
    ...manifestFixture(),
    compositions: [
      { compositionId: "comp-landscape", aeProjectItemIndex: 3, name: "Landscape Master", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
      { compositionId: "comp-reels", aeProjectItemIndex: 7, name: "Reels Master", widthPx: 1080, heightPx: 1920, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ]
  };
}

function stubWorkspace(planOverrides: Record<string, unknown> = {}, manifest = manifestWithCompositions()): void {
  stubFetchByUrl({
    [`/api/projects/${PROJECT_ID}/execution-plan/render-outputs`]: { status: 200, body: { plan: planFixture(planOverrides), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(planOverrides), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest } }
  });
}

function renderTab(): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectRenderSettingsTab />
    </ProjectWorkspaceProvider>
  );
}

describe("ProjectRenderSettingsTab", () => {
  it("shows the honest no-compositions state when the manifest has none", async () => {
    stubWorkspace({}, manifestFixture());
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

  it("renders in Hebrew when the active locale is he - real translated strings, not English fallback text", async () => {
    stubWorkspace({}, manifestFixture());
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectRenderSettingsTab />
      </ProjectWorkspaceProvider>,
      { locale: "he" }
    );
    const titles = await screen.findAllByText("אין קומפוזיציות זמינות");
    expect(titles).toHaveLength(2);
  });
});
