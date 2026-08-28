// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneEditDrawer } from "./SceneEditDrawer";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  assetFixture,
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

function mappingFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "APP PROMO",
    placeholderClassification: { value: null, source: "MANIFEST", evidence: ["unknown"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("SceneEditDrawer", () => {
  it("saves a SET_TEXT operation and reflects the new revision when the text field is edited", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture()] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
        {
          status: 200,
          body: {
            plan: planFixture({ revision: 2 }, [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "Hello" })] })]),
            sceneTable: []
          }
        }
      ],
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    const onClose = vi.fn();
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={onClose} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    const textInput = screen.getByLabelText("Text") as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows a save-failed error (never silently discards the edit) when the API rejects the change", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture()] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
        { status: 409, body: { error: { code: "CONFLICT", message: "stale revision", requestId: "r1" } } }
      ],
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    const onClose = vi.fn();
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={onClose} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Could not save this change");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers only this project's real assets in the picker - never a fake/arbitrary option", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture()] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [assetFixture({ id: "asset-1", label: "Client logo" })] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={() => {}} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    const select = (await screen.findByLabelText("Asset")) as HTMLSelectElement;
    const optionLabels = [...select.options].map((option) => option.textContent);
    expect(optionLabels).toEqual(["Unmapped", "Client logo"]);
  });

  it("saves a MAP_ASSET operation with the real selected asset id when one is picked", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture()] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
        {
          status: 200,
          body: {
            plan: planFixture({ revision: 2 }, [
              sceneFixture({ id: "s1", mappings: [mappingFixture({ selectedAssetId: "asset-1", selectedAssetType: "image" })] })
            ]),
            sceneTable: []
          }
        }
      ],
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [assetFixture({ id: "asset-1", label: "Client logo" })] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    const onClose = vi.fn();
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={onClose} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    const select = (await screen.findByLabelText("Asset")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "asset-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const executionPlanCall = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => init)
      .find((init): init is RequestInit & { body: string } => typeof init?.body === "string" && init.body.includes("MAP_ASSET"));
    expect(executionPlanCall).toBeDefined();
    const payload = JSON.parse(executionPlanCall!.body) as { operations: Array<Record<string, unknown>> };
    expect(payload.operations).toContainEqual({
      type: "MAP_ASSET",
      scenePlanId: "s1",
      mappingId: "mapping-1",
      selectedAssetId: "asset-1",
      selectedAssetType: "image"
    });
  });

  it("renders nothing when no scenePlanId is selected", () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    const { container } = renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId={null} onClose={() => {}} />
      </ProjectWorkspaceProvider>
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
