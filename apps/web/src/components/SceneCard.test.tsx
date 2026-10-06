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
  it("a genuinely resolved, zero-mapping scene shows 'Nothing to change here' and 'Original content kept' / 'Original text preserved' / 'Original timing preserved'", () => {
    const scene = realScene({ mappings: [], unresolvedReasons: [], approvalState: "READY_FOR_APPROVAL" });
    renderCard(scene);

    expect(screen.getByText("Nothing to change here")).not.toBeNull();
    expect(screen.getByText("Original content kept")).not.toBeNull();
    expect(screen.getByText("Original text preserved")).not.toBeNull();
    expect(screen.getByText("Original timing preserved")).not.toBeNull();
    expect(screen.queryByText("No picture chosen")).toBeNull();
    expect(screen.queryByText("Template's own text")).toBeNull();
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
    expect(screen.getByText("No picture chosen")).not.toBeNull();
    expect(screen.getByText("Template's own text")).not.toBeNull();
    // A length nobody set is the template's own - it no longer takes a line.
    expect(screen.queryByText("Not set yet")).toBeNull();
    expect(screen.queryByText("Nothing to change here")).toBeNull();
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
    expect(screen.queryByText("Nothing to change here")).toBeNull();
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
 * screen and texts still read "No picture chosen".
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
    expect(screen.queryByText("No picture chosen")).toBeNull();
  });
});

/**
 * REAL 2026-10-04 DEAD END: a text layer left "as the template has it"
 * recorded nothing, its scene stayed at "needs your choice" and Approve stayed
 * disabled with no control left on the page that could clear it.
 */
describe("SceneCard - a text nobody decided about can be kept as the template has it", () => {
  const textKind = { value: "text", source: "MANIFEST", evidence: [] };
  function renderWithKeep(mappings: unknown[], onKeep: (ids: string[], findings: MappingSuggestion[]) => void, pending: MappingSuggestion[] = []) {
    renderWithLocale(
      <SceneCard
        projectId={PROJECT_ID}
        realScene={realScene({ mappings: mappings as never })}
        assets={[]}
        previewEntry={READY_PREVIEW}
        pendingSuggestions={pending}
        suggestionsBusy={false}
        onEdit={() => {}}
        onRegeneratePreview={() => {}}
        onAcceptSuggestion={() => {}}
        onRejectSuggestion={() => {}}
        onKeepTemplateText={onKeep}
      />
    );
  }

  it("asks plainly, and one press hands back exactly the undecided text layers", () => {
    const kept: string[][] = [];
    renderWithKeep(
      [
        mappingFixture({ id: "m-credit", placeholderName: "Credit line", placeholderClassification: textKind }),
        mappingFixture({ id: "m-done", placeholderName: "Headline", placeholderClassification: textKind, text: "Written" }),
        mappingFixture({ id: "m-kept", placeholderName: "Footer", placeholderClassification: textKind, keepTemplateText: { decision: "KEEP_TEMPLATE_TEXT" } })
      ],
      (ids) => kept.push(ids)
    );
    expect(screen.getByText("1 text here has not been decided")).toBeTruthy();
    expect(screen.getByText("Credit line")).toBeTruthy();
    screen.getByRole("button", { name: "Keep the template's text" }).click();
    expect(kept).toEqual([["m-credit"]]);
  });

  it("agreeing with a no-change finding about a text layer records the decision for that layer too", () => {
    const calls: { ids: string[]; findings: string[] }[] = [];
    const finding = mappingSuggestionFixture({ id: "f-1", mappingId: "m-credit", suggestedText: null, reasoning: "template credit" });
    renderWithKeep(
      [mappingFixture({ id: "m-credit", placeholderName: "Credit line", placeholderClassification: textKind })],
      (ids, findings) => calls.push({ ids, findings: findings.map((f) => f.id) }),
      [finding as never]
    );
    // A finding is already asking about it - no second question for the same layer.
    expect(screen.queryByText("1 text here has not been decided")).toBeNull();
    screen.getByRole("button", { name: "OK - leave it as it is" }).click();
    expect(calls).toEqual([{ ids: ["m-credit"], findings: ["f-1"] }]);
  });

  // REAL 2026-10-06 (client project 3241977f): an empty background picture
  // place kept "The whole video" at "Needs your choice" with nothing to press.
  it("shows an open text by the template's own words, opens the panel on that very text, and names the words it would keep", () => {
    const kept: string[][] = [];
    const opened: (string | undefined)[] = [];
    renderWithLocale(
      <SceneCard
        projectId={PROJECT_ID}
        realScene={realScene({
          mappings: [
            mappingFixture({ id: "m-headline", placeholderName: "Layer 7", placeholderClassification: textKind }),
            mappingFixture({ id: "m-unknown", placeholderName: "Layer 9", placeholderClassification: textKind })
          ] as never
        })}
        assets={[]}
        previewEntry={READY_PREVIEW}
        pendingSuggestions={[]}
        suggestionsBusy={false}
        onEdit={(focusMappingId) => opened.push(focusMappingId)}
        onRegeneratePreview={() => {}}
        onAcceptSuggestion={() => {}}
        onRejectSuggestion={() => {}}
        onKeepTemplateText={(ids) => kept.push(ids)}
        templateTextOf={(mapping) => (mapping.id === "m-headline" ? "SAMPLE WORD" : null)}
      />
    );
    // The words the video would carry, not the layer's name - and the layer's name where the words are not known.
    expect(screen.getByText('"SAMPLE WORD"')).toBeTruthy();
    expect(screen.queryByText("Layer 7")).toBeNull();
    expect(screen.getByText("Layer 9")).toBeTruthy();
    screen.getAllByRole("button", { name: "Write my own text" })[0]!.click();
    expect(opened).toEqual(["m-headline"]);
    screen.getByRole("button", { name: 'Keep "SAMPLE WORD"' }).click();
    expect(kept).toEqual([["m-headline"]]);
    // The card's general button still opens the panel at its top.
    screen.getByRole("button", { name: "Change picture or text" }).click();
    expect(opened).toEqual(["m-headline", undefined]);
  });

  it("offers 'No text here' for an open text when the page can record it, and hands back exactly that text", () => {
    const emptied: string[] = [];
    renderWithLocale(
      <SceneCard
        projectId={PROJECT_ID}
        realScene={realScene({ mappings: [mappingFixture({ id: "m-small", placeholderName: "Layer 3", placeholderClassification: textKind })] as never })}
        assets={[]}
        previewEntry={READY_PREVIEW}
        pendingSuggestions={[]}
        suggestionsBusy={false}
        onEdit={() => {}}
        onRegeneratePreview={() => {}}
        onAcceptSuggestion={() => {}}
        onRejectSuggestion={() => {}}
        onKeepTemplateText={() => {}}
        onNoText={(mappingId) => emptied.push(mappingId)}
      />
    );
    screen.getByRole("button", { name: "No text here" }).click();
    expect(emptied).toEqual(["m-small"]);
  });

  it("an empty picture place asks too, and one press records 'leave it as the template has it' for exactly that place", () => {
    const kept: string[][] = [];
    const imageKind = { ...textKind, value: "image" };
    renderWithKeep(
      [
        mappingFixture({ id: "m-background", placeholderName: "Background", placeholderClassification: imageKind }),
        mappingFixture({ id: "m-filled", placeholderName: "Screen", placeholderClassification: imageKind, selectedAssetId: "asset-1", selectedAssetType: "image" }),
        mappingFixture({ id: "m-left", placeholderName: "Other", placeholderClassification: imageKind, keepTemplateText: { decision: "KEEP_TEMPLATE_TEXT" } })
      ],
      (ids) => kept.push(ids)
    );
    expect(screen.getByText("1 picture place here is empty")).toBeTruthy();
    expect(screen.getByText("Needs your choice")).toBeTruthy();
    screen.getByRole("button", { name: "Leave it as the template has it" }).click();
    expect(kept).toEqual([["m-background"]]);
  });

  it("says nothing when every text is written or already kept", () => {
    renderWithKeep([mappingFixture({ id: "m-done", placeholderClassification: textKind, text: "Written" })], () => {});
    expect(screen.queryByText(/has not been decided/)).toBeNull();
  });
});

/**
 * 2026-10-04: "Preview generating…" was a badge and nothing else - no sign
 * that anything was moving, or for how long.
 */
describe("SceneCard - a preview being made says so, with a clock", () => {
  it("a running preview shows a notice with elapsed time and says it appears by itself", () => {
    renderCard(realScene(), { preview: null, state: "generating", isStale: false, errorMessage: null, hasFailed: false, startedAt: Date.now() - 23_000 });
    const notice = screen.getByText("After Effects is making this preview…").closest(".busy-notice") as HTMLElement;
    expect(notice.querySelector(".busy-notice__elapsed")).not.toBeNull();
    expect(notice.textContent).toContain("It appears here by itself");
  });

  it("a preview waiting behind another says it is waiting its turn - and shows no clock, because nothing has started", () => {
    renderCard(realScene(), { preview: null, state: "queued", isStale: false, errorMessage: null, hasFailed: false });
    const notice = screen.getByText("Waiting its turn - previews are made one at a time.").closest(".busy-notice") as HTMLElement;
    expect(notice.querySelector(".busy-notice__elapsed")).toBeNull();
  });

  it("a finished preview shows no notice at all", () => {
    renderCard(realScene());
    expect(document.querySelector(".busy-notice")).toBeNull();
  });
});
