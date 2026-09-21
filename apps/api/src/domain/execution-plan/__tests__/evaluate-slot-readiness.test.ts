import { describe, expect, it } from "vitest";
import {
  assessMappingSlot,
  classifySlotSemantics,
  describeSlotBlockers,
  findSlotBlockers,
  fitModeForRole,
  slotEvidenceDigest,
  SLOT_SEMANTICS_MODEL_VERSION,
  type SlotAssetFacts,
  type TemplateManifest
} from "@dyo/schemas";
import { manifestFixture, mappingFixture, scenePlanFixture } from "../test-support/template-copy-fixtures.js";
import { conflictingSlotFacts, deviceScreenSlotFacts, flatCardSlotFacts, imagePlaceholderFixture, slotFactsFixture } from "../test-support/slot-fixtures.js";
import type { Placeholder, PlaceholderMapping } from "@dyo/schemas";

/**
 * The slot gate, end to end over synthetic structures only. Every fixture is
 * built from a mechanism (rendered matte / drawn mask / 3D / animated parent),
 * never from a real template - and several carry deliberately misleading names
 * so the "names decide nothing" guarantee is exercised here too, not only in
 * the classifier's own unit tests.
 */

function manifestWith(placeholders: readonly Placeholder[]): TemplateManifest {
  const manifest = manifestFixture([]);
  return { ...manifest, scenes: [{ ...(manifest.scenes[0] as TemplateManifest["scenes"][number]), placeholders: [...placeholders] }] };
}

const SCREENSHOT: SlotAssetFacts = { id: "asset-screenshot", widthPx: 1080, heightPx: 2160, hasAlpha: false };
const LOGO: SlotAssetFacts = { id: "asset-logo", widthPx: 800, heightPx: 800, hasAlpha: true };
const WIDE: SlotAssetFacts = { id: "asset-wide", widthPx: 1600, heightPx: 900, hasAlpha: false };

function planFor(spec: { placeholderId: string; assetId: string | null; assetType: PlaceholderMapping["selectedAssetType"] }) {
  return scenePlanFixture({
    id: "scene-1",
    mappings: [
      mappingFixture({
        id: spec.placeholderId,
        placeholderClassification: { value: "image", source: "MANIFEST", evidence: [] },
        selectedAssetId: spec.assetId,
        selectedAssetType: spec.assetType
      })
    ]
  });
}

describe("fitModeForRole", () => {
  it("contains a logo so it is never cropped, and covers everything else", () => {
    expect(fitModeForRole("logo")).toBe("contain");
    expect(fitModeForRole("image")).toBe("cover");
    expect(fitModeForRole(null)).toBe("cover");
  });
});

describe("assessMappingSlot", () => {
  it("clears a confidently-classified device screen holding a matching screenshot", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: "image" });
    const assessment = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: SCREENSHOT });
    expect(assessment.semantics?.classification).toBe("device_screen");
    expect(assessment.blockers).toEqual([]);
  });

  it("asks nothing of a mapping that places no asset", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1" })]);
    const scene = planFor({ placeholderId: "p1", assetId: null, assetType: null });
    expect(assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: null }).blockers).toEqual([]);
  });

  it("blocks a manifest-linked slot that carries no verdict at all, and points at re-inspection", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: null })]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: "image" });
    const [blocker, ...rest] = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: SCREENSHOT }).blockers;
    expect(rest).toEqual([]);
    expect(blocker?.kind).toBe("SLOT_SEMANTICS_MISSING");
    expect(blocker?.requiresEvidenceFrame).toBe(false);
    expect(blocker?.reason).toContain("re-run template inspection");
  });

  it("judges nothing about a human-added mapping that has no manifest placeholder", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1" })]);
    const scene = scenePlanFixture({
      id: "scene-1",
      mappings: [mappingFixture({ id: "human-1", manifestPlaceholderId: null, selectedAssetId: SCREENSHOT.id, selectedAssetType: "image" })]
    });
    expect(assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: SCREENSHOT }).blockers).toEqual([]);
  });

  it("refuses to reinterpret a verdict produced by a different model version", () => {
    const stale = { ...classifySlotSemantics(deviceScreenSlotFacts()), modelVersion: "slot-semantics-v0" };
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotSemantics: stale })]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: "image" });
    const [blocker] = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: SCREENSHOT }).blockers;
    expect(blocker?.kind).toBe("SLOT_SEMANTICS_STALE_MODEL");
    expect(blocker?.reason).toContain(SLOT_SEMANTICS_MODEL_VERSION);
  });

  it("blocks a slot whose evidence genuinely conflicts, and offers a frame from its visible window", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: conflictingSlotFacts() })]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: "image" });
    const blockers = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: SCREENSHOT }).blockers;
    const uncertain = blockers.find((b) => b.kind === "SLOT_CLASSIFICATION_UNCERTAIN");
    expect(uncertain).toBeDefined();
    expect(uncertain?.requiresEvidenceFrame).toBe(true);
    expect(uncertain?.evidenceFrameAtSeconds).toBe(4);
  });

  it("reports no usable evidence moment when no host reported when the slot is on screen", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: conflictingSlotFacts({ visibleWindowSeconds: null }) })]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: "image" });
    const [blocker] = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: SCREENSHOT }).blockers;
    expect(blocker?.requiresEvidenceFrame).toBe(true);
    expect(blocker?.evidenceFrameAtSeconds).toBeNull();
  });

  it("refuses a logo dropped into a phone screen even when the fit itself would be fine", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
    const scene = planFor({ placeholderId: "p1", assetId: LOGO.id, assetType: "logo" });
    const blockers = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: LOGO }).blockers;
    const conflict = blockers.find((b) => b.kind === "ASSET_SLOT_CONFLICT");
    expect(conflict).toBeDefined();
    expect(conflict?.compatibility?.findings.map((f) => f.code)).toContain("LOGO_INTO_DEVICE_SCREEN");
  });

  it("refuses a full opaque screenshot dropped into a decorative card", () => {
    // Same aspect as the card, so nothing about the FIT objects - only the
    // slot's purpose does.
    const cardShapedScreenshot: SlotAssetFacts = { id: "asset-card-shaped", widthPx: 1600, heightPx: 900, hasAlpha: false };
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: flatCardSlotFacts() })]);
    const scene = planFor({ placeholderId: "p1", assetId: cardShapedScreenshot.id, assetType: "image" });
    const blockers = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: cardShapedScreenshot }).blockers;
    const conflict = blockers.find((b) => b.kind === "ASSET_SLOT_CONFLICT");
    expect(conflict?.compatibility?.findings.map((f) => f.code)).toContain("SCREENSHOT_INTO_FLAT_CARD");
    expect(blockers.some((b) => b.kind === "UNSAFE_FIT")).toBe(false);
  });

  it("accepts a phone_screen-role asset in a device screen, and refuses the same asset in a card", () => {
    const screen = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
    const card = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: flatCardSlotFacts({ widthPx: 1080, heightPx: 2160 }) })]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: "phone_screen" });
    expect(assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest: screen, asset: SCREENSHOT }).blockers).toEqual([]);
    expect(
      assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest: card, asset: SCREENSHOT }).blockers.some((b) => b.kind === "ASSET_SLOT_CONFLICT")
    ).toBe(true);
  });

  it("refuses a transparent asset in a device screen - the phone would show what is behind it", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
    const transparent: SlotAssetFacts = { id: "asset-transparent", widthPx: 1080, heightPx: 2160, hasAlpha: true };
    const scene = planFor({ placeholderId: "p1", assetId: transparent.id, assetType: "image" });
    const conflict = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: transparent }).blockers.find((b) => b.kind === "ASSET_SLOT_CONFLICT");
    expect(conflict?.compatibility?.findings.map((f) => f.code)).toContain("TRANSPARENT_ASSET_INTO_DEVICE_SCREEN");
  });

  it("refuses a mapping whose asset role was never declared", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: null });
    const conflict = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: SCREENSHOT }).blockers.find((b) => b.kind === "ASSET_SLOT_CONFLICT");
    expect(conflict?.compatibility?.findings.map((f) => f.code)).toContain("ROLE_UNDECLARED");
  });

  it("blocks a correct layer with a wrong fit - a landscape asset covering a tall screen loses most of itself", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
    const scene = planFor({ placeholderId: "p1", assetId: WIDE.id, assetType: "image" });
    const blockers = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: WIDE }).blockers;
    const unsafe = blockers.find((b) => b.kind === "UNSAFE_FIT");
    expect(unsafe).toBeDefined();
    expect(unsafe?.fit?.flags).toContain("EXCESSIVE_CROP");
    expect(unsafe?.fit?.mode).toBe("cover");
  });

  it("blocks when the asset's own dimensions were never measured, rather than assuming they fit", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
    const scene = planFor({ placeholderId: "p1", assetId: "asset-unmeasured", assetType: "image" });
    const blockers = assessMappingSlot({
      scene,
      mapping: scene.mappings[0]!,
      manifest,
      asset: { id: "asset-unmeasured", widthPx: null, heightPx: null, hasAlpha: null }
    }).blockers;
    expect(blockers.map((b) => b.kind)).toContain("ASSET_SLOT_CONFLICT");
    expect(blockers.some((b) => b.kind === "UNSAFE_FIT" && b.fit?.flags.includes("DIMENSIONS_UNKNOWN"))).toBe(true);
  });

  it("judges nothing about a non-slot placeholder - a text line is not a window into anything", () => {
    const manifest = manifestWith([{ ...imagePlaceholderFixture({ placeholderId: "p1", slotFacts: null }), placeholderType: "text", sourceType: "TextLayer" }]);
    const scene = planFor({ placeholderId: "p1", assetId: LOGO.id, assetType: "logo" });
    expect(assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: LOGO }).blockers).toEqual([]);
  });

  it("does not let a misleading name change any verdict", () => {
    const deviceFacts = deviceScreenSlotFacts();
    const honest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceFacts })]);
    const misleading = manifestWith([
      imagePlaceholderFixture({
        placeholderId: "p1",
        layerName: "decorative card panel",
        slotFacts: { ...deviceFacts, slotLayerName: "decorative card panel", slotCompositionName: "cards/banner tile" }
      })
    ]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: "image" });
    const a = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest: honest, asset: SCREENSHOT });
    const b = assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest: misleading, asset: SCREENSHOT });
    expect(b.semantics?.classification).toBe(a.semantics?.classification);
    expect(b.semantics?.confidence).toBe(a.semantics?.confidence);
    expect(b.blockers).toEqual(a.blockers);
  });
});

describe("slotEvidenceDigest", () => {
  it("is stable for the same findings and different for different ones", () => {
    const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
    const logoScene = planFor({ placeholderId: "p1", assetId: LOGO.id, assetType: "logo" });
    const wideScene = planFor({ placeholderId: "p1", assetId: WIDE.id, assetType: "image" });
    const first = slotEvidenceDigest(assessMappingSlot({ scene: logoScene, mapping: logoScene.mappings[0]!, manifest, asset: LOGO }));
    const again = slotEvidenceDigest(assessMappingSlot({ scene: logoScene, mapping: logoScene.mappings[0]!, manifest, asset: LOGO }));
    const other = slotEvidenceDigest(assessMappingSlot({ scene: wideScene, mapping: wideScene.mappings[0]!, manifest, asset: WIDE }));
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });
});

describe("findSlotBlockers", () => {
  const manifest = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: deviceScreenSlotFacts() })]);
  const assets = new Map<string, SlotAssetFacts>([
    [LOGO.id, LOGO],
    [WIDE.id, WIDE],
    [SCREENSHOT.id, SCREENSHOT]
  ]);

  it("ignores scenes that are not used at all", () => {
    const scene = { ...planFor({ placeholderId: "p1", assetId: LOGO.id, assetType: "logo" }), use: false };
    expect(findSlotBlockers([scene], manifest, assets)).toEqual([]);
  });

  it("clears a blocker when an explicit decision matches exactly what is blocking", () => {
    const scene = planFor({ placeholderId: "p1", assetId: LOGO.id, assetType: "logo" });
    const digest = slotEvidenceDigest(assessMappingSlot({ scene, mapping: scene.mappings[0]!, manifest, asset: LOGO }));
    const decided = {
      ...scene,
      mappings: [
        {
          ...scene.mappings[0]!,
          slotReview: {
            decision: "ACCEPT" as const,
            classification: null,
            decidedBy: "reviewer@example.test",
            decidedAt: "2026-01-02T00:00:00.000Z",
            evidenceDigest: digest,
            evidenceFrameStorageKey: "evidence/frame.png"
          }
        }
      ]
    };
    expect(findSlotBlockers([decided], manifest, assets)).toEqual([]);
  });

  it("does not let a decision made about different findings cover a new problem", () => {
    const logoScene = planFor({ placeholderId: "p1", assetId: LOGO.id, assetType: "logo" });
    const staleDigest = slotEvidenceDigest(assessMappingSlot({ scene: logoScene, mapping: logoScene.mappings[0]!, manifest, asset: LOGO }));
    const swapped = {
      ...planFor({ placeholderId: "p1", assetId: WIDE.id, assetType: "image" }),
      mappings: [
        {
          ...planFor({ placeholderId: "p1", assetId: WIDE.id, assetType: "image" }).mappings[0]!,
          slotReview: {
            decision: "ACCEPT" as const,
            classification: null,
            decidedBy: "reviewer@example.test",
            decidedAt: "2026-01-02T00:00:00.000Z",
            evidenceDigest: staleDigest,
            evidenceFrameStorageKey: "evidence/frame.png"
          }
        }
      ]
    };
    const blockers = findSlotBlockers([swapped], manifest, assets);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers[0]?.reason).toContain("made about different findings");
  });

  it("describes each blocker with the scene and layer an operator can act on", () => {
    const scene = planFor({ placeholderId: "p1", assetId: LOGO.id, assetType: "logo" });
    const lines = describeSlotBlockers(findSlotBlockers([scene], manifest, assets));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("Scene Under Test");
    expect(lines[0]).toContain("ASSET_SLOT_CONFLICT");
  });

  it("treats an unknown asset id as unmeasured rather than as a fitting asset", () => {
    const scene = planFor({ placeholderId: "p1", assetId: "asset-not-in-project", assetType: "image" });
    expect(findSlotBlockers([scene], manifest, new Map()).length).toBeGreaterThan(0);
  });

  it("reports a slot that is never provably visible without inventing a timestamp", () => {
    const invisible = manifestWith([imagePlaceholderFixture({ placeholderId: "p1", slotFacts: slotFactsFixture({ visibleWindowSeconds: null, widthPx: null, heightPx: null }) })]);
    const scene = planFor({ placeholderId: "p1", assetId: SCREENSHOT.id, assetType: "image" });
    const blockers = findSlotBlockers([scene], invisible, assets);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.every((b) => b.evidenceFrameAtSeconds === null)).toBe(true);
  });
});
