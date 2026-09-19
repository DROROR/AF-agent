import { describe, expect, it } from "vitest";
import { describeTemplateCopyBlockers, findTemplateCopyBlockers } from "../evaluate-template-copy.js";
import { computeTextVerification, sha256Hex } from "@dyo/schemas";
import { manifestFixture, mappingFixture, scenePlanFixture } from "../test-support/template-copy-fixtures.js";

const DECIDED_AT = "2026-01-01T00:00:00.000Z";

describe("findTemplateCopyBlockers", () => {
  it("blocks a mapping whose text is still the template's own wording, naming the scene and the layer", () => {
    const manifest = manifestFixture([{ placeholderId: "ph-headline", layerName: "Headline", originalText: "Assets" }]);
    const scenes = [
      scenePlanFixture({
        id: "scene-a",
        compositionName: "Opening",
        mappings: [mappingFixture({ id: "ph-headline", placeholderName: "Headline", text: "Assets" })]
      })
    ];

    const blockers = findTemplateCopyBlockers(scenes, manifest);

    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.assessment.status).toBe("IDENTICAL");
    expect(describeTemplateCopyBlockers(blockers)[0]).toContain("Opening / Headline");
  });

  it("passes a mapping whose text was genuinely replaced", () => {
    const manifest = manifestFixture([{ placeholderId: "ph-headline", originalText: "Assets" }]);
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-headline", text: "Your own words" })] })];
    expect(findTemplateCopyBlockers(scenes, manifest)).toEqual([]);
  });

  it("handles duplicate template copy in several scenes INDEPENDENTLY - deciding one never clears the other", () => {
    // Two different scenes whose placeholders carry the SAME template wording:
    // a real pattern when a template repeats a line across its scenes.
    const manifest = manifestFixture([
      { placeholderId: "ph-scene-a", layerName: "Line", originalText: "Shared template line" },
      { placeholderId: "ph-scene-b", layerName: "Line", originalText: "Shared template line" }
    ]);
    const scenes = [
      scenePlanFixture({
        id: "scene-a",
        compositionName: "First",
        mappings: [
          mappingFixture({
            id: "ph-scene-a",
            text: "Shared template line",
            keepTemplateText: { decision: "KEEP_TEMPLATE_TEXT", decidedBy: "user-1", decidedAt: DECIDED_AT, textAtDecision: "Shared template line" }
          })
        ]
      }),
      scenePlanFixture({
        id: "scene-b",
        compositionName: "Second",
        mappings: [mappingFixture({ id: "ph-scene-b", text: "Shared template line" })]
      })
    ];

    const blockers = findTemplateCopyBlockers(scenes, manifest);

    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.scenePlanId).toBe("scene-b");
  });

  it("judges only scenes marked for use - an excluded scene renders nothing", () => {
    const manifest = manifestFixture([{ placeholderId: "ph-1", originalText: "Assets" }]);
    const scenes = [scenePlanFixture({ id: "scene-a", use: false, mappings: [mappingFixture({ id: "ph-1", text: "Assets" })] })];
    expect(findTemplateCopyBlockers(scenes, manifest)).toEqual([]);
  });

  it("blocks against a LEGACY manifest that never captured template text, naming re-inspection", () => {
    const manifest = manifestFixture([{ placeholderId: "ph-1" }]);
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-1", text: "Anything the reviewer typed" })] })];

    const blockers = findTemplateCopyBlockers(scenes, manifest);

    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.assessment.status).toBe("TEMPLATE_TEXT_UNKNOWN");
    expect(describeTemplateCopyBlockers(blockers)[0]).toContain("re-run template inspection");
  });

  it("treats a truncated capture WITHOUT digests as unverifiable - a partial string is never compared as if it were the whole text", () => {
    // Digests are what make a long text verifiable (see the dedicated describe
    // below); an excerpt on its own never is.
    const manifest = manifestFixture([{ placeholderId: "ph-1", originalText: "A very long line that was cut", originalTextTruncated: true }]);
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-1", text: "A very long line that was cut" })] })];
    expect(findTemplateCopyBlockers(scenes, manifest)[0]?.assessment.status).toBe("TEMPLATE_TEXT_UNKNOWN");
  });

  it("blocks when the plan references a placeholder the current manifest no longer has", () => {
    const manifest = manifestFixture([{ placeholderId: "ph-other", originalText: "Assets" }]);
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-gone", text: "Assets" })] })];
    expect(findTemplateCopyBlockers(scenes, manifest)[0]?.assessment.status).toBe("TEMPLATE_TEXT_UNKNOWN");
  });

  it("never blocks a human-added mapping, which has no template wording to be a copy of", () => {
    const manifest = manifestFixture([]);
    const scenes = [
      scenePlanFixture({
        id: "scene-a",
        mappings: [mappingFixture({ id: "human-1", manifestPlaceholderId: null, mappingSource: "HUMAN", text: "Text a person added" })]
      })
    ];
    expect(findTemplateCopyBlockers(scenes, manifest)).toEqual([]);
  });

  it("ignores mappings with no text at all - asset and colour decisions are not this gate's business", () => {
    const manifest = manifestFixture([{ placeholderId: "ph-image", originalText: null, placeholderType: "image" }]);
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-image", text: null, selectedAssetId: "asset-1" })] })];
    expect(findTemplateCopyBlockers(scenes, manifest)).toEqual([]);
  });

  it("reports every blocking mapping across several scenes, in scene then mapping order", () => {
    const manifest = manifestFixture([
      { placeholderId: "ph-1", layerName: "One", originalText: "First template line" },
      { placeholderId: "ph-2", layerName: "Two", originalText: "Second template line" },
      { placeholderId: "ph-3", layerName: "Three", originalText: "Third template line" }
    ]);
    const scenes = [
      scenePlanFixture({
        id: "scene-a",
        compositionName: "First",
        mappings: [
          mappingFixture({ id: "ph-1", placeholderName: "One", text: "First template line" }),
          mappingFixture({ id: "ph-2", placeholderName: "Two", text: "SECOND TEMPLATE LINE" })
        ]
      }),
      scenePlanFixture({ id: "scene-b", compositionName: "Second", mappings: [mappingFixture({ id: "ph-3", placeholderName: "Three", text: "Genuinely new" })] })
    ];

    const blockers = findTemplateCopyBlockers(scenes, manifest);

    expect(blockers.map((blocker) => blocker.mappingId)).toEqual(["ph-1", "ph-2"]);
    expect(blockers[1]?.assessment.variantKind).toBe("CASE");
  });
});

describe("findTemplateCopyBlockers - template text too long to store (2026-09-19 correction)", () => {
  const BOUND = 10_000;
  const completeText = `${"a".repeat(BOUND)} with a real ending`;

  /** A manifest whose placeholder carries only an excerpt plus the complete text's digests - what a long template text now produces. */
  function longTextManifest() {
    return manifestFixture([
      {
        placeholderId: "ph-long",
        layerName: "Long Line",
        originalTextTruncated: true,
        originalTextPreview: completeText.slice(0, BOUND),
        originalTextVerification: { ...computeTextVerification(completeText), sourceProjectSha256: "a".repeat(64) }
      }
    ]);
  }

  it("blocks identical long text without ever asking for an impossible re-inspection", () => {
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-long", text: completeText })] })];
    const blockers = findTemplateCopyBlockers(scenes, longTextManifest());

    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.assessment.status).toBe("IDENTICAL");
    expect(blockers[0]?.assessment.reason).not.toMatch(/re-run template inspection/);
  });

  it("passes long text that differs only after the stored excerpt ends", () => {
    const replaced = `${"a".repeat(BOUND)} with the client's own ending`;
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-long", text: replaced })] })];
    expect(findTemplateCopyBlockers(scenes, longTextManifest())).toEqual([]);
  });

  it("still catches a case-only variant of a long text", () => {
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-long", text: completeText.toUpperCase() })] })];
    expect(findTemplateCopyBlockers(scenes, longTextManifest())[0]?.assessment.variantKind).toBe("CASE");
  });

  it("clears once the reviewer explicitly keeps the long template wording", () => {
    const scenes = [
      scenePlanFixture({
        id: "scene-a",
        mappings: [
          mappingFixture({
            id: "ph-long",
            text: completeText,
            keepTemplateText: {
              decision: "KEEP_TEMPLATE_TEXT",
              decidedBy: "user-1",
              decidedAt: DECIDED_AT,
              textAtDecision: completeText,
              textDigestAtDecision: sha256Hex(completeText)
            }
          })
        ]
      })
    ];
    expect(findTemplateCopyBlockers(scenes, longTextManifest())).toEqual([]);
  });

  it("only a manifest with NEITHER text nor digests asks for re-inspection", () => {
    const legacy = manifestFixture([{ placeholderId: "ph-1" }]);
    const scenes = [scenePlanFixture({ id: "scene-a", mappings: [mappingFixture({ id: "ph-1", text: "anything" })] })];
    expect(findTemplateCopyBlockers(scenes, legacy)[0]?.assessment.reason).toMatch(/re-run template inspection/);
  });
});
