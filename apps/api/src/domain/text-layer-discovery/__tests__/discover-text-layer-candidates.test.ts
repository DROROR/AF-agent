import { describe, expect, it } from "vitest";
import type { LayerDetailFact } from "@dyo/schemas";
import { discoverTextLayerCandidates, matchesRequiredText } from "../discover-text-layer-candidates.js";

function fact(overrides: Partial<LayerDetailFact> = {}): LayerDetailFact {
  return {
    layerIndex: 1,
    layerName: "Layer",
    layerType: "OTHER",
    sourceText: null,
    sourceCompositionId: null,
    stretchPercent: null,
    timeRemapEnabled: null,
    ...overrides
  };
}

describe("discoverTextLayerCandidates", () => {
  it("finds a text layer directly in the owner composition with nestedTarget: null (same-composition case)", () => {
    const result = discoverTextLayerCandidates({
      ownerCompositionId: "comp-210",
      layerDetailsByCompositionId: {
        "comp-210": [fact({ layerIndex: 5, layerName: "Footer Text", layerType: "TEXT", sourceText: "מבית DYO App" })]
      }
    });
    expect(result).toEqual([
      {
        compositionId: "comp-210",
        layerIndex: 5,
        layerName: "Footer Text",
        sourceText: "מבית DYO App",
        nestedTarget: null,
        reachableFromOwner: true
      }
    ]);
  });

  it("real-shaped regression: reproduces the EXACT 4-hop nested chain proven live for the App Logo mapping (!Render > Scene 1 > Pre-comp 3 > App Emblem > App Logo), substituting a TEXT layer for the final image layer", () => {
    const result = discoverTextLayerCandidates({
      ownerCompositionId: "comp-210",
      layerDetailsByCompositionId: {
        // The owner's own layer index referencing "Scene 1" is never part
        // of the resulting chain (real, verified behavior) - its value is
        // deliberately irrelevant here (set to 99 to make that explicit).
        "comp-210": [fact({ layerIndex: 99, layerName: "Scene 1", layerType: "PRECOMP", sourceCompositionId: "comp-1" })],
        "comp-1": [fact({ layerIndex: 3, layerName: "Pre-comp 3", layerType: "PRECOMP", sourceCompositionId: "comp-1635" })],
        "comp-1635": [fact({ layerIndex: 1, layerName: "App Emblem", layerType: "PRECOMP", sourceCompositionId: "comp-1044" })],
        "comp-1044": [fact({ layerIndex: 1, layerName: "App Logo", layerType: "PRECOMP", sourceCompositionId: "comp-1113" })],
        "comp-1113": [fact({ layerIndex: 1, layerName: "Hebrew Branding", layerType: "TEXT", sourceText: "מבית DYO App" })]
      }
    });
    expect(result).toEqual([
      {
        compositionId: "comp-1113",
        layerIndex: 1,
        layerName: "Hebrew Branding",
        sourceText: "מבית DYO App",
        nestedTarget: [
          { compositionId: "comp-1", layerIndex: 3 },
          { compositionId: "comp-1635", layerIndex: 1 },
          { compositionId: "comp-1044", layerIndex: 1 },
          { compositionId: "comp-1113", layerIndex: 1 }
        ],
        reachableFromOwner: true
      }
    ]);
  });

  it("finds multiple text layers across multiple branches of the tree", () => {
    const result = discoverTextLayerCandidates({
      ownerCompositionId: "root",
      layerDetailsByCompositionId: {
        root: [
          fact({ layerIndex: 1, layerName: "Branch A", layerType: "PRECOMP", sourceCompositionId: "a" }),
          fact({ layerIndex: 2, layerName: "Branch B", layerType: "PRECOMP", sourceCompositionId: "b" }),
          fact({ layerIndex: 3, layerName: "Root Title", layerType: "TEXT", sourceText: "Root text" })
        ],
        a: [fact({ layerIndex: 1, layerName: "A Text", layerType: "TEXT", sourceText: "A text" })],
        b: [fact({ layerIndex: 1, layerName: "B Text", layerType: "TEXT", sourceText: "B text" })]
      }
    });
    expect(result.map((c) => c.sourceText).sort()).toEqual(["A text", "B text", "Root text"]);
    const rootCandidate = result.find((c) => c.sourceText === "Root text");
    expect(rootCandidate?.nestedTarget).toBeNull();
    const aCandidate = result.find((c) => c.sourceText === "A text");
    expect(aCandidate?.nestedTarget).toEqual([{ compositionId: "a", layerIndex: 1 }]);
  });

  it("never fails or hangs on a cyclic precomp graph - visits each composition at most once per path", () => {
    const result = discoverTextLayerCandidates({
      ownerCompositionId: "root",
      layerDetailsByCompositionId: {
        root: [fact({ layerIndex: 1, layerName: "Into A", layerType: "PRECOMP", sourceCompositionId: "a" })],
        a: [
          fact({ layerIndex: 1, layerName: "Back To Root", layerType: "PRECOMP", sourceCompositionId: "root" }),
          fact({ layerIndex: 2, layerName: "A Text", layerType: "TEXT", sourceText: "A text" })
        ]
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.sourceText).toBe("A text");
  });

  it("re-visits a composition reached via two DIFFERENT real parent paths (a precomp legitimately reused in two places) - not treated as a cycle", () => {
    const result = discoverTextLayerCandidates({
      ownerCompositionId: "root",
      layerDetailsByCompositionId: {
        root: [
          fact({ layerIndex: 1, layerName: "Scene A", layerType: "PRECOMP", sourceCompositionId: "scene-a" }),
          fact({ layerIndex: 2, layerName: "Scene B", layerType: "PRECOMP", sourceCompositionId: "scene-b" })
        ],
        "scene-a": [fact({ layerIndex: 1, layerName: "Shared Logo Ref", layerType: "PRECOMP", sourceCompositionId: "shared-logo" })],
        "scene-b": [fact({ layerIndex: 1, layerName: "Shared Logo Ref", layerType: "PRECOMP", sourceCompositionId: "shared-logo" })],
        "shared-logo": [fact({ layerIndex: 1, layerName: "Logo Text", layerType: "TEXT", sourceText: "Shared" })]
      }
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.nestedTarget)).toEqual([
      [
        { compositionId: "scene-a", layerIndex: 1 },
        { compositionId: "shared-logo", layerIndex: 1 }
      ],
      [
        { compositionId: "scene-b", layerIndex: 1 },
        { compositionId: "shared-logo", layerIndex: 1 }
      ]
    ]);
  });

  it("a PRECOMP layer whose sourceCompositionId has no entry in layerDetailsByCompositionId contributes nothing further, never throws", () => {
    const result = discoverTextLayerCandidates({
      ownerCompositionId: "root",
      layerDetailsByCompositionId: {
        root: [fact({ layerIndex: 1, layerName: "Uninspected Child", layerType: "PRECOMP", sourceCompositionId: "not-inspected" })]
      }
    });
    expect(result).toEqual([]);
  });

  it("ignores AV and OTHER layers entirely - never mistaken for text or precomp evidence", () => {
    const result = discoverTextLayerCandidates({
      ownerCompositionId: "root",
      layerDetailsByCompositionId: {
        root: [fact({ layerIndex: 1, layerType: "AV" }), fact({ layerIndex: 2, layerType: "OTHER" })]
      }
    });
    expect(result).toEqual([]);
  });

  it("a TEXT layer with sourceText: null (real sourceText read failed) is never reported as a candidate", () => {
    const result = discoverTextLayerCandidates({
      ownerCompositionId: "root",
      layerDetailsByCompositionId: {
        root: [fact({ layerIndex: 1, layerType: "TEXT", sourceText: null })]
      }
    });
    expect(result).toEqual([]);
  });

  it("returns [] when the owner composition has no entry at all", () => {
    expect(discoverTextLayerCandidates({ ownerCompositionId: "root", layerDetailsByCompositionId: {} })).toEqual([]);
  });
});

describe("matchesRequiredText", () => {
  const candidate = (sourceText: string) =>
    discoverTextLayerCandidates({
      ownerCompositionId: "root",
      layerDetailsByCompositionId: { root: [fact({ layerIndex: 1, layerType: "TEXT", sourceText })] }
    })[0]!;

  it("matches the exact required Hebrew string by codepoint", () => {
    expect(matchesRequiredText(candidate("מבית DYO App"), "מבית DYO App")).toBe(true);
  });

  it("REGRESSION: never matches the reversed Hebrew form - never trusts visual/terminal RTL rendering, only real codepoints", () => {
    // תיבמ is the exact reverse of מבית's own codepoints (U+05EA U+05D9 U+05D1 U+05DE vs U+05DE U+05D1 U+05D9 U+05EA).
    expect(matchesRequiredText(candidate("תיבמ DYO App"), "מבית DYO App")).toBe(false);
  });

  it("does not match a substring or a superstring", () => {
    expect(matchesRequiredText(candidate("מבית DYO App Extra"), "מבית DYO App")).toBe(false);
    expect(matchesRequiredText(candidate("DYO App"), "מבית DYO App")).toBe(false);
  });

  it("does not match different but visually similar text", () => {
    expect(matchesRequiredText(candidate("Some Other Text"), "מבית DYO App")).toBe(false);
  });
});
