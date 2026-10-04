// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MappingSuggestion, ScenePlanEntry } from "@dyo/schemas";
import { SceneCard } from "./SceneCard";
import type { RealScene } from "../lib/real-scene-grouping";
import type { ScenePreviewEntry } from "../lib/use-scene-preview-queue";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { mappingSuggestionFixture, sceneFixture } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
});

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function realScene(overrides: Partial<ScenePlanEntry> = {}): RealScene {
  const scenePlan = { reelsLayout: null, ...sceneFixture(overrides) } as ScenePlanEntry;
  return { manifestCompositionId: scenePlan.manifestCompositionId, sceneName: scenePlan.compositionName, scenePlan, nested: [] };
}

const READY_PREVIEW: ScenePreviewEntry = { preview: null, state: "ready", isStale: false, errorMessage: null, hasFailed: false };

function renderCard(scene: RealScene, previewEntry: ScenePreviewEntry = READY_PREVIEW, pendingSuggestions: MappingSuggestion[] = []) {
  renderWithLocale(
    <SceneCard
      projectId={PROJECT_ID}
      realScene={scene}
      assets={null}
      previewEntry={previewEntry}
      pendingSuggestions={pendingSuggestions}
      suggestionsBusy={false}
      onEdit={() => {}}
      onRegeneratePreview={() => {}}
      onAcceptSuggestion={() => {}}
      onRejectSuggestion={() => {}}
    />
  );
}

/**
 * Live QA Blocker 3 fix - a scene that is resolved because it genuinely
 * has nothing editable (mappings: [], approvalState READY_FOR_APPROVAL,
 * per compute-scene-unresolved-reasons.ts's own new
 * isStructurallyResolvedWithNoMappings rule) must show honest "kept as
 * original" copy - never the old "needs a choice" wording that implies a
 * pending decision that does not actually exist. A scene with a REAL
 * pending mapping decision must keep showing the existing wording,
 * unchanged.
 */
describe("SceneCard - zero-mapping resolved scenes show 'kept as original' copy (live QA Blocker 3 fix)", () => {
  it("a genuinely resolved, zero-mapping scene shows 'No content matching required' and 'Original content kept' / 'Original text preserved' / 'Original timing preserved'", () => {
    const scene = realScene({ mappings: [], unresolvedReasons: [], approvalState: "READY_FOR_APPROVAL" });
    renderCard(scene);

    expect(screen.getByText("No content matching required")).not.toBeNull();
    expect(screen.getByText("Original content kept")).not.toBeNull();
    expect(screen.getByText("Original text preserved")).not.toBeNull();
    expect(screen.getByText("Original timing preserved")).not.toBeNull();
    expect(screen.queryByText("No asset assigned yet")).toBeNull();
    expect(screen.queryByText("No text set")).toBeNull();
    expect(screen.queryByText("Not set yet")).toBeNull();
    expect(screen.queryByText("Needs your choice")).toBeNull();
  });

  it("a scene with a REAL pending mapping decision still shows the existing 'Needs your choice' behavior, unchanged", () => {
    const scene = realScene({
      mappings: [
        {
          id: "m1",
          manifestPlaceholderId: "ph-1",
          placeholderName: "Headline",
          placeholderClassification: { value: "text", source: "MANIFEST", evidence: ["manifest"] },
          selectedAssetId: null,
          selectedAssetType: null,
          text: null,
          assetTimestamp: null,
          colorHex: null,
          layerVisible: null,
          freezeAtSeconds: null,
          layerDurationSeconds: null,
          humanLayerIndex: null,
          humanNestedTarget: null,
          mappingSource: "MANIFEST",
          confidence: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      unresolvedReasons: ["1 placeholder(s) in this scene still need a mapping decision"],
      approvalState: "UNREVIEWED"
    });
    renderCard(scene);

    expect(screen.getByText("Needs your choice")).not.toBeNull();
    expect(screen.getByText("No asset assigned yet")).not.toBeNull();
    expect(screen.getByText("No text set")).not.toBeNull();
    expect(screen.getByText("Not set yet")).not.toBeNull();
    expect(screen.queryByText("No content matching required")).toBeNull();
    expect(screen.queryByText("Original content kept")).toBeNull();
  });

  it("a genuine detail-fetch failure (zero mappings, still UNREVIEWED) keeps the existing 'Needs your choice' wording - never shown as if resolved", () => {
    const scene = realScene({
      mappings: [],
      unresolvedReasons: ["ae_get_composition did not return usable layer data for this composition"],
      approvalState: "UNREVIEWED"
    });
    renderCard(scene);

    expect(screen.getByText("Needs your choice")).not.toBeNull();
    expect(screen.queryByText("No content matching required")).toBeNull();
    expect(screen.queryByText("Original content kept")).toBeNull();
  });

  it("a zero-mapping resolved scene with a genuine pending Mapping Assistant suggestion still shows 'Needs your choice' - a real review always takes priority", () => {
    const scene = realScene({ mappings: [], unresolvedReasons: [], approvalState: "READY_FOR_APPROVAL" });
    const pendingSuggestion = mappingSuggestionFixture({ scenePlanId: scene.scenePlan.id, suggestedText: "Hello" }) as MappingSuggestion;
    renderCard(scene, READY_PREVIEW, [pendingSuggestion]);

    expect(screen.getByText("Needs your choice")).not.toBeNull();
  });
});

/**
 * REAL 2026-10-04: a scene whose preview failed said "Please try again" and
 * offered no way to - the only control was folded under Advanced details.
 */
describe("SceneCard - a failed preview can be tried again where the failure is shown", () => {
  it("shows Try again beside the failure, and nothing extra when there is none", () => {
    const failed: ScenePreviewEntry = { preview: null, state: "unavailable", isStale: false, errorMessage: "After Effects did not produce a picture.", hasFailed: true };
    renderCard(realScene(), failed);
    expect(screen.getByRole("button", { name: "Try again" }).hasAttribute("disabled")).toBe(false);

    cleanup();
    renderCard(realScene());
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

/**
 * REAL 2026-10-04: after the whole plan was applied, every scene with a phone
 * screen and texts still read "No asset assigned yet".
 */
function mappingFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Layer",
    placeholderClassification: { value: null, source: "MANIFEST", evidence: ["unknown"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    humanLayerIndex: null,
    humanNestedTarget: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("SceneCard - a scene's picture and wording are read from the layers that hold them", () => {
  it("shows the assigned file and the text when they sit on different layers, whichever comes first", () => {
    const text = mappingFixture({ id: "m-text", text: "Headline", selectedAssetId: null });
    const picture = mappingFixture({ id: "m-picture", text: null, selectedAssetId: "asset-1" });
    const scene = realScene({ mappings: [text, picture] as never, unresolvedReasons: [], approvalState: "READY_FOR_APPROVAL" });
    renderWithLocale(
      <SceneCard
        projectId={PROJECT_ID}
        realScene={scene}
        assets={[{ id: "asset-1", label: "screenshot", originalFilename: "s.png", mimeType: "image/png" } as never]}
        previewEntry={READY_PREVIEW}
        pendingSuggestions={[]}
        suggestionsBusy={false}
        onEdit={() => {}}
        onRegeneratePreview={() => {}}
        onAcceptSuggestion={() => {}}
        onRejectSuggestion={() => {}}
      />
    );
    expect(screen.getByText("screenshot")).not.toBeNull();
    expect(screen.getAllByText("Headline").length).toBeGreaterThan(0);
    expect(screen.queryByText("No asset assigned yet")).toBeNull();
  });
});
