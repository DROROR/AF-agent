import { describe, expect, it } from "vitest";
import type { ScenePlanEntry } from "@dyo/schemas";
import { buildEvidenceBundles } from "../build-evidence-bundles.js";
import type { AssetRecord } from "../../asset/types.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");

function mapping(overrides: Partial<ScenePlanEntry["mappings"][number]> = {}): ScenePlanEntry["mappings"][number] {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Hero Image",
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
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides
  };
}

function scene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [mapping()],
    reelsLayout: null,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides
  };
}

function asset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: "asset-1",
    projectId: "proj-1",
    originalFilename: "hero.png",
    storageKey: "proj-1/hero.png",
    mediaKind: "IMAGE",
    mimeType: "image/png",
    byteSize: 100,
    sha256: "a".repeat(64),
    width: null,
    height: null,
    durationSeconds: null,
    label: null,
    notes: null,
    uploadedAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

describe("buildEvidenceBundles", () => {
  it("produces one bundle per unmapped mapping", () => {
    const bundles = buildEvidenceBundles({ scenePlans: [scene()], assets: [], workMap: null, brandInputs: null });
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ scenePlanId: "scene-1", mappingId: "mapping-1", manifestCompositionId: "comp-1" });
  });

  it("skips a mapping that already has a real selectedAssetId - it is already resolved", () => {
    const bundles = buildEvidenceBundles({
      scenePlans: [scene({ mappings: [mapping({ selectedAssetId: "asset-1" })] })],
      assets: [],
      workMap: null,
      brandInputs: null
    });
    expect(bundles).toHaveLength(0);
  });

  it("produces exactly one scene-level bundle (mappingId: null) for a scene with zero detected mappings", () => {
    const bundles = buildEvidenceBundles({ scenePlans: [scene({ mappings: [] })], assets: [], workMap: null, brandInputs: null });
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.mappingId).toBeNull();
  });

  it("never produces a bundle for an excluded scene (use: false) - it will never appear in the final output", () => {
    const bundles = buildEvidenceBundles({ scenePlans: [scene({ use: false })], assets: [], workMap: null, brandInputs: null });
    expect(bundles).toHaveLength(0);
  });

  it("attaches the real Work Map entry matched by sourceCompositionId, never a mismatched one", () => {
    const bundles = buildEvidenceBundles({
      scenePlans: [scene({ manifestCompositionId: "comp-1" })],
      assets: [],
      workMap: {
        entries: [
          {
            id: "e1",
            sourceCompositionId: "comp-999",
            sourceReference: null,
            desiredAssetId: null,
            desiredText: "wrong scene",
            assetTimestampSeconds: null,
            desiredDurationSeconds: null,
            instructions: null
          },
          {
            id: "e2",
            sourceCompositionId: "comp-1",
            sourceReference: null,
            desiredAssetId: null,
            desiredText: "right scene",
            assetTimestampSeconds: null,
            desiredDurationSeconds: null,
            instructions: null
          }
        ]
      },
      brandInputs: null
    });
    expect(bundles[0]?.workMapEntry?.id).toBe("e2");
  });

  it("carries the project's real assets/brand inputs/scene instructions through untouched", () => {
    const realAsset = asset({ id: "asset-7" });
    const bundles = buildEvidenceBundles({
      scenePlans: [scene({ instructions: "Use the client's own hero shot" })],
      assets: [realAsset],
      workMap: null,
      brandInputs: { logoAssetId: "asset-7", brandColors: ["#112233"], textInstructions: null }
    });
    expect(bundles[0]?.candidateAssets).toEqual([realAsset]);
    expect(bundles[0]?.userInstructions).toBe("Use the client's own hero shot");
    expect(bundles[0]?.brandInputs?.logoAssetId).toBe("asset-7");
  });
});
