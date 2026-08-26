import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { buildScenePlans } from "../build-execution-plan.js";

const fixedNow = () => new Date("2026-08-26T00:00:00.000Z");

/**
 * A small synthetic manifest exercising the same three real shapes seen
 * on the real client template: a composition with real detected
 * placeholders, a composition-level-only one (ae_get_composition detail
 * unavailable - recorded via unknownItems, exactly as
 * heroic-swan-template-inspector.ts really does it), and a nested-only
 * composition (never a scene candidate).
 */
function syntheticManifest(overrides: Partial<TemplateManifest> = {}): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: fixedNow().toISOString(),
    compositions: [
      { compositionId: "comp-detailed", name: "Scene A", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
      { compositionId: "comp-no-detail", name: "Scene B", widthPx: 1920, heightPx: 1080, durationSeconds: 3, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
      { compositionId: "comp-nested", name: "Nested Precomp", widthPx: 500, heightPx: 500, durationSeconds: 2, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-detailed"] }
    ],
    scenes: [
      {
        sceneId: "scene-a",
        displayName: null,
        compositionId: "comp-detailed",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: [
          {
            placeholderId: "ph-1",
            displayLabel: null,
            compositionId: "comp-detailed",
            layerName: "Headline",
            layerIndex: 1,
            layerPath: [],
            placeholderType: "unknown",
            editable: false,
            sourceType: "Unknown",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "unknown", reason: "no confident structural signal matched a known placeholder type" }
          }
        ]
      },
      {
        sceneId: "scene-b",
        displayName: null,
        compositionId: "comp-no-detail",
        originalOrderIndex: 1,
        startTimeSeconds: 0,
        durationSeconds: 3,
        placeholders: []
      }
      // comp-nested has isNestedOnlyReferenced: true, so build-manifest.ts's
      // own real filter would never include it in scenes[] either.
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: [
      { context: "Headline", reason: "no confident structural signal matched a known placeholder type" },
      { context: "Scene B", reason: "ae_get_composition did not return usable layer data for this composition - only composition-level facts (name/dimensions/duration) are confirmed" }
    ],
    ...overrides
  };
}

describe("buildScenePlans", () => {
  it("preserves every composition, including the composition-level-only and nested-only ones", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    expect(scenePlans).toHaveLength(3);
    expect(scenePlans.map((s) => s.manifestCompositionId)).toEqual(["comp-detailed", "comp-no-detail", "comp-nested"]);
  });

  it("carries the composition-level-only manifest reason forward verbatim, never re-derived differently", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    const sceneB = scenePlans.find((s) => s.manifestCompositionId === "comp-no-detail");
    expect(sceneB?.mappings).toEqual([]);
    expect(sceneB?.unresolvedReasons).toEqual([
      "ae_get_composition did not return usable layer data for this composition - only composition-level facts (name/dimensions/duration) are confirmed"
    ]);
  });

  it("defaults a nested-only composition to excluded (use: false), never guessed as a real scene", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    const nested = scenePlans.find((s) => s.manifestCompositionId === "comp-nested");
    expect(nested?.use).toBe(false);
    expect(nested?.unresolvedReasons).toEqual(["composition is nested-only - not a candidate top-level scene"]);
  });

  it("defaults a real candidate scene to included (use: true)", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    const sceneA = scenePlans.find((s) => s.manifestCompositionId === "comp-detailed");
    expect(sceneA?.use).toBe(true);
  });

  it("keeps an unknown placeholder classification unknown (null value) - never invents a label", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    const sceneA = scenePlans.find((s) => s.manifestCompositionId === "comp-detailed");
    expect(sceneA?.mappings).toHaveLength(1);
    expect(sceneA?.mappings[0]?.placeholderClassification.value).toBeNull();
    expect(sceneA?.mappings[0]?.placeholderClassification.source).toBe("MANIFEST");
    expect(sceneA?.mappings[0]?.placeholderClassification.evidence).toEqual([
      "no confident structural signal matched a known placeholder type"
    ]);
  });

  it("retains real manifest evidence/facts (layerName, placeholder id) on each mapping", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    const mapping = scenePlans.find((s) => s.manifestCompositionId === "comp-detailed")?.mappings[0];
    expect(mapping?.manifestPlaceholderId).toBe("ph-1");
    expect(mapping?.placeholderName).toBe("Headline");
  });

  it("never fabricates a selectedAssetId/text/assetTimestamp - all null from the deterministic builder", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    const mapping = scenePlans.find((s) => s.manifestCompositionId === "comp-detailed")?.mappings[0];
    expect(mapping?.selectedAssetId).toBeNull();
    expect(mapping?.text).toBeNull();
    expect(mapping?.assetTimestamp).toBeNull();
  });

  it("preserves source ordering via sourcePosition, and defaults finalOrder equal to it", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    const sceneA = scenePlans.find((s) => s.manifestCompositionId === "comp-detailed");
    const sceneB = scenePlans.find((s) => s.manifestCompositionId === "comp-no-detail");
    expect(sceneA?.sourcePosition).toBe(0);
    expect(sceneA?.finalOrder).toBe(0);
    expect(sceneB?.sourcePosition).toBe(1);
    expect(sceneB?.finalOrder).toBe(1);
  });

  it("produces stable, deterministic IDs - running the builder twice on the same manifest gives identical output", () => {
    const manifest = syntheticManifest();
    const first = buildScenePlans(manifest, fixedNow);
    const second = buildScenePlans(manifest, fixedNow);
    expect(first).toEqual(second);
  });

  it("gives different manifests different scene-plan IDs (structural, not random)", () => {
    const scenePlansA = buildScenePlans(syntheticManifest(), fixedNow);
    const scenePlansB = buildScenePlans(
      syntheticManifest({
        compositions: [
          { compositionId: "comp-other", name: "Other", widthPx: 100, heightPx: 100, durationSeconds: 1, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
        ],
        scenes: []
      }),
      fixedNow
    );
    expect(scenePlansA[0]?.id).not.toBe(scenePlansB[0]?.id);
  });

  it("initializes every scene as UNREVIEWED - no scene is pre-approved by the deterministic builder", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    expect(scenePlans.every((s) => s.approvalState === "UNREVIEWED")).toBe(true);
  });

  it("never sets finalDuration - always null until a human sets it", () => {
    const scenePlans = buildScenePlans(syntheticManifest(), fixedNow);
    expect(scenePlans.every((s) => s.finalDuration === null)).toBe(true);
  });
});
