import { describe, expect, it } from "vitest";
import { classifySlotSemantics, SCHEMA_VERSION, type Placeholder, type SlotStructuralFacts, type TemplateManifest } from "@dyo/schemas";
import { ExecutionPlanEditError, PreconditionNotMetError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { InMemorySceneEvidencePreviewRepository } from "../../../domain/scene-evidence-preview/test-support/in-memory-scene-evidence-preview-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { updateExecutionPlan } from "../update-execution-plan.js";
import { approveExecutionPlan } from "../approve-execution-plan.js";
import { deviceScreenSlotFacts, flatCardSlotFacts, conflictingSlotFacts } from "../../../domain/execution-plan/test-support/slot-fixtures.js";
import type { BrandRulesConfig } from "../../../domain/brand-rules/validate-brand-rules.js";

/**
 * THE SLOT GATE AS THE BACKEND ACTUALLY ENFORCES IT - real plan creation, real
 * edits, real approval, real asset records. Every structure is synthetic and
 * described by mechanism; no real template appears here.
 */

const NOW = new Date("2026-09-19T00:00:00.000Z");
const fixedNow = () => NOW;
const USER_ID = "22222222-2222-2222-2222-222222222222";

const NO_BRAND_RULES: BrandRulesConfig = {
  requireLogoPresence: false,
  requiredHebrewText: "",
  dyoBlueHex: null,
  rtlPreservedByConstruction: true
};

interface SlotSpec {
  placeholderId: string;
  layerName: string;
  facts: SlotStructuralFacts | null;
}

function manifest(specs: readonly SlotSpec[]): TemplateManifest {
  const placeholders: Placeholder[] = specs.map((spec, index) => ({
    placeholderId: spec.placeholderId,
    displayLabel: null,
    compositionId: "comp-a",
    layerName: spec.layerName,
    layerIndex: index + 1,
    layerPath: [],
    placeholderType: "image",
    editable: true,
    sourceType: "AVLayer",
    ...(spec.facts === null ? {} : { slotFacts: spec.facts, slotSemantics: classifySlotSemantics(spec.facts) }),
    dimensions: spec.facts?.widthPx && spec.facts?.heightPx ? { width: spec.facts.widthPx, height: spec.facts.heightPx } : null,
    startTimeSeconds: 0,
    durationSeconds: 5,
    evidence: { source: "read_directly", reason: "AE layer type is AVLayer" }
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-under-test",
    templateName: "Template Under Test",
    sourceProject: { path: "/copies/under-test.aep", name: "under-test.aep", sha256: "b".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [
      {
        compositionId: "comp-a",
        aeProjectItemIndex: 1,
        name: "Scene A",
        widthPx: 1920,
        heightPx: 1080,
        durationSeconds: 5,
        frameRate: 30,
        isNestedOnlyReferenced: false,
        parentCompositionIds: []
      }
    ],
    scenes: [
      {
        sceneId: "scene-a",
        displayName: null,
        compositionId: "comp-a",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

interface AssetSpec {
  id: string;
  width: number | null;
  height: number | null;
  hasAlphaChannel: boolean | null;
  hasTransparentPixels: boolean | null;
  transparentPixelRatio: number | null;
}

let captureCount = 0;

async function setup(manifestValue: TemplateManifest, assets: readonly AssetSpec[]) {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const assetRepository = new InMemoryAssetRepository();
  const sceneEvidencePreviewRepository = new InMemorySceneEvidencePreviewRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifestValue });
  for (const asset of assets) {
    await assetRepository.create(
      {
        id: asset.id,
        projectId: project.projectId,
        originalFilename: `${asset.id}.png`,
        storageKey: `storage/${asset.id}`,
        mediaKind: "IMAGE",
        mimeType: "image/png",
        byteSize: 1,
        sha256: "c".repeat(64),
        width: asset.width,
        height: asset.height,
        hasAlphaChannel: asset.hasAlphaChannel,
        pixelAnalysis: asset.hasTransparentPixels === null ? "NOT_DECODED" : "DECODED",
        hasTransparentPixels: asset.hasTransparentPixels,
        transparentPixelRatio: asset.transparentPixelRatio,
        visibleCoverageRatio: asset.transparentPixelRatio === null ? null : 1 - asset.transparentPixelRatio,
        visibleContentBounds: null,
        durationSeconds: null,
        label: null,
        notes: null
      },
      NOW
    );
  }
  const plan = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
  const scene = plan.plan.scenePlans[0]!;
  const mappingIdFor = (placeholderId: string) => scene.mappings.find((mapping) => mapping.manifestPlaceholderId === placeholderId)!.id;
  const edit = (operations: Parameters<typeof updateExecutionPlan>[2]["operations"], baseRevision: number) =>
    updateExecutionPlan(
      { executionPlanRepository, assetRepository, projectRepository, sceneEvidencePreviewRepository, now: fixedNow },
      project.projectId,
      { baseRevision, operations },
      USER_ID
    );

  /**
   * A real captured evidence frame for this scene's composition, exactly as an
   * INSPECT_SCENE_EVIDENCE job's own upload records one - including WHICH
   * moment it shows and WHICH SLOT it was captured for, which is what makes it
   * proof of anything. `slotMappingId: null` is the shape of every frame
   * captured before slot attribution existed.
   */
  const captureEvidenceFrame = async (
    overrides: { storageKey?: string; capturedAtSeconds?: number | null; sourceProjectSha256?: string; slotMappingId?: string | null } = {}
  ) => {
    const record = await sceneEvidencePreviewRepository.record(
      {
        id: `00000000-0000-4000-8000-${String(captureCount++).padStart(12, "0")}`,
        projectId: project.projectId,
        jobId: `10000000-0000-4000-8000-${String(captureCount).padStart(12, "0")}`,
        manifestCompositionId: "comp-a",
        sourceProjectSha256: overrides.sourceProjectSha256 ?? manifestValue.sourceProject.sha256,
        filename: "scene-preview.png",
        mimeType: "image/png",
        byteSize: 128,
        storageKey: overrides.storageKey ?? `evidence/frame-${captureCount}.png`,
        sha256: "d".repeat(64),
        capturedAt: NOW,
        capturedAtSeconds: overrides.capturedAtSeconds === undefined ? 2.5 : overrides.capturedAtSeconds,
        slotMappingId: overrides.slotMappingId === undefined ? null : overrides.slotMappingId
      },
      new Date(NOW.getTime() + captureCount * 1000)
    );
    return record.storageKey;
  };
  const approve = (baseRevision: number) =>
    approveExecutionPlan({ executionPlanRepository, projectRepository, assetRepository, now: fixedNow, brandRulesConfig: NO_BRAND_RULES }, project.projectId, USER_ID, {
      baseRevision
    });
  return { project, projectRepository, executionPlanRepository, assetRepository, sceneEvidencePreviewRepository, captureEvidenceFrame, sceneId: scene.id, mappingIdFor, edit, approve };
}

const SCREENSHOT: AssetSpec = { id: "asset-screenshot", width: 1080, height: 2160, hasAlphaChannel: false, hasTransparentPixels: false, transparentPixelRatio: 0 };
const LOGO: AssetSpec = { id: "asset-logo", width: 800, height: 800, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.7 };
const UNMEASURED: AssetSpec = { id: "asset-unmeasured", width: null, height: null, hasAlphaChannel: null, hasTransparentPixels: null, transparentPixelRatio: null };

describe("approveExecutionPlan - slot semantics and fit (real backend gate)", () => {
  it("approves a confident screen slot holding a matching screenshot", async () => {
    const { sceneId, mappingIdFor, edit, approve } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [SCREENSHOT]
    );
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: mappingIdFor("ph-1"), selectedAssetId: SCREENSHOT.id, selectedAssetType: "image" }], 1);
    expect((await approve(2)).plan.status).toBe("APPROVED");
  });

  it("refuses approval when a logo is mapped into a device screen, and names the finding", async () => {
    const { sceneId, mappingIdFor, edit, approve, executionPlanRepository, project } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [LOGO]
    );
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: mappingIdFor("ph-1"), selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);

    const attempt = approve(2);
    await expect(attempt).rejects.toThrow(PreconditionNotMetError);
    await expect(attempt).rejects.toThrow(/unresolved slot findings/i);
    await expect(attempt).rejects.toThrow(/ASSET_SLOT_CONFLICT/);

    expect((await executionPlanRepository.findCurrentByProjectId(project.projectId))?.status).toBe("DRAFT");
  });

  it("refuses approval while a slot's own classification is uncertain", async () => {
    const { sceneId, mappingIdFor, edit, approve } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: conflictingSlotFacts() }]),
      [SCREENSHOT]
    );
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: mappingIdFor("ph-1"), selectedAssetId: SCREENSHOT.id, selectedAssetType: "image" }], 1);
    await expect(approve(2)).rejects.toThrow(/SLOT_CLASSIFICATION_UNCERTAIN/);
  });

  it("refuses approval when the asset was never measured - an unmeasurable asset is not a fitting one", async () => {
    const { sceneId, mappingIdFor, edit, approve } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [UNMEASURED]
    );
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: mappingIdFor("ph-1"), selectedAssetId: UNMEASURED.id, selectedAssetType: "image" }], 1);
    await expect(approve(2)).rejects.toThrow(/unresolved slot findings/i);
  });

  it("refuses approval when the manifest predates slot discovery, and names re-inspection", async () => {
    const { sceneId, mappingIdFor, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: null }]), [SCREENSHOT]);
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: mappingIdFor("ph-1"), selectedAssetId: SCREENSHOT.id, selectedAssetType: "image" }], 1);
    await expect(approve(2)).rejects.toThrow(/re-run template inspection/);
  });

  it("clears the gate only through an explicit decision carrying the evidence frame the reviewer saw", async () => {
    const { sceneId, mappingIdFor, edit, approve, captureEvidenceFrame } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [LOGO]
    );
    const mappingId = mappingIdFor("ph-1");
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);
    await expect(approve(2)).rejects.toThrow(/unresolved slot findings/i);

    // A decision with no evidence frame is refused outright: a reviewer who
    // never saw the slot has not reviewed it.
    await expect(edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT" }], 2)).rejects.toThrow(ExecutionPlanEditError);
    await expect(edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT" }], 2)).rejects.toThrow(/evidence frame/i);

    // Nor does naming a frame that was never captured count as having seen one.
    await expect(
      edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT", evidenceFrameStorageKey: "evidence/not-a-real-capture.png" }], 2)
    ).rejects.toThrow(/most recent captured frame/);

    const storageKey = await captureEvidenceFrame();
    const decided = await edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT", evidenceFrameStorageKey: storageKey }], 2);
    expect(decided.plan.scenePlans[0]?.mappings[0]?.slotReview).toMatchObject({
      decision: "ACCEPT",
      decidedBy: USER_ID,
      decidedAt: NOW.toISOString(),
      evidenceFrameStorageKey: storageKey
    });
    expect((await approve(3)).plan.status).toBe("APPROVED");
  });

  it("refuses a frame that shows a moment the slot is not on screen", async () => {
    const { sceneId, mappingIdFor, edit, captureEvidenceFrame } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [LOGO]
    );
    const mappingId = mappingIdFor("ph-1");
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);

    // The slot is on screen from 2s to 6s; this frame shows the very start of
    // the scene, where it is not.
    const outsideWindow = await captureEvidenceFrame({ capturedAtSeconds: 0 });
    await expect(
      edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT", evidenceFrameStorageKey: outsideWindow }], 2)
    ).rejects.toThrow(/does not show a moment this slot is on screen/);

    const unknownMoment = await captureEvidenceFrame({ capturedAtSeconds: null });
    await expect(
      edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT", evidenceFrameStorageKey: unknownMoment }], 2)
    ).rejects.toThrow(/does not show a moment this slot is on screen/);
  });

  it("refuses a frame captured from a different version of the template than the plan is bound to", async () => {
    const { sceneId, mappingIdFor, edit, captureEvidenceFrame } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [LOGO]
    );
    const mappingId = mappingIdFor("ph-1");
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);

    const fromAnotherSource = await captureEvidenceFrame({ sourceProjectSha256: "e".repeat(64) });
    await expect(
      edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT", evidenceFrameStorageKey: fromAnotherSource }], 2)
    ).rejects.toThrow(/different version of the template/);
  });

  it("records an override of the classification itself, with the classification the reviewer asserts", async () => {
    const { sceneId, mappingIdFor, edit, approve, captureEvidenceFrame } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: conflictingSlotFacts() }]),
      [SCREENSHOT]
    );
    const mappingId = mappingIdFor("ph-1");
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: SCREENSHOT.id, selectedAssetType: "image" }], 1);
    await expect(
      edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "OVERRIDE_CLASSIFICATION", evidenceFrameStorageKey: await captureEvidenceFrame() }], 2)
    ).rejects.toThrow(/classification/i);

    const decided = await edit(
      [
        {
          type: "SET_SLOT_REVIEW",
          scenePlanId: sceneId,
          mappingId,
          decision: "OVERRIDE_CLASSIFICATION",
          classification: "device_screen",
          evidenceFrameStorageKey: await captureEvidenceFrame()
        }
      ],
      2
    );
    expect(decided.plan.scenePlans[0]?.mappings[0]?.slotReview?.classification).toBe("device_screen");
    expect((await approve(3)).plan.status).toBe("APPROVED");
  });

  it("a decision made about earlier findings does not survive a later asset change", async () => {
    const { sceneId, mappingIdFor, edit, approve, captureEvidenceFrame } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [LOGO, UNMEASURED]
    );
    const mappingId = mappingIdFor("ph-1");
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);
    await edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT", evidenceFrameStorageKey: await captureEvidenceFrame() }], 2);
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: UNMEASURED.id, selectedAssetType: "image" }], 3);

    await expect(approve(4)).rejects.toThrow(/made about different findings/);
  });

  it("CLEAR_SLOT_REVIEW puts the mapping back to needing a decision", async () => {
    const { sceneId, mappingIdFor, edit, approve, captureEvidenceFrame } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [LOGO]
    );
    const mappingId = mappingIdFor("ph-1");
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);
    await edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT", evidenceFrameStorageKey: await captureEvidenceFrame() }], 2);
    await edit([{ type: "CLEAR_SLOT_REVIEW", scenePlanId: sceneId, mappingId }], 3);
    await expect(approve(4)).rejects.toThrow(/unresolved slot findings/i);
  });

  it("refuses to record a slot decision with no known user - an unattributable decision is not auditable", async () => {
    const { sceneId, mappingIdFor, edit, executionPlanRepository, assetRepository, projectRepository, sceneEvidencePreviewRepository, captureEvidenceFrame, project } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: deviceScreenSlotFacts() }]),
      [LOGO]
    );
    const mappingId = mappingIdFor("ph-1");
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);
    await expect(
      updateExecutionPlan(
        { executionPlanRepository, assetRepository, projectRepository, sceneEvidencePreviewRepository, now: fixedNow },
        project.projectId,
        {
          baseRevision: 2,
          operations: [{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId, decision: "ACCEPT", evidenceFrameStorageKey: await captureEvidenceFrame() }]
        },
        undefined
      )
    ).rejects.toThrow(/identity/i);
  });

  /**
   * REAL 2026-09-24 DEFECT (docs/ACCEPTANCE.md): every slot has its OWN
   * visible moment, so one composition legitimately holds several current
   * evidence frames at once - but the gate verified a decision against the
   * composition's single most recent frame. Capturing slot B's frame
   * therefore superseded the frame slot A's not-yet-saved decision named, and
   * a scene with three slots needing decisions could not be completed through
   * the dashboard at all; it took three separate capture-then-record round
   * trips driven through the API.
   *
   * The two slots below are on screen at genuinely different moments (0-2s and
   * 3-5s), so neither one's frame can ever stand in for the other's - which is
   * exactly why one "latest frame" per composition was never enough.
   */
  describe("several slots in one scene, each with its own evidence frame", () => {
    const twoSlots = () =>
      manifest([
        { placeholderId: "ph-early", layerName: "a layer", facts: deviceScreenSlotFacts({ visibleWindowSeconds: { startSeconds: 0, endSeconds: 2 } }) },
        { placeholderId: "ph-late", layerName: "another layer", facts: deviceScreenSlotFacts({ visibleWindowSeconds: { startSeconds: 3, endSeconds: 5 } }) }
      ]);

    it("decides both slots in one pass, each naming its own captured frame", async () => {
      const { sceneId, mappingIdFor, edit, approve, captureEvidenceFrame } = await setup(twoSlots(), [LOGO]);
      const early = mappingIdFor("ph-early");
      const late = mappingIdFor("ph-late");
      await edit(
        [
          { type: "MAP_ASSET", scenePlanId: sceneId, mappingId: early, selectedAssetId: LOGO.id, selectedAssetType: "logo" },
          { type: "MAP_ASSET", scenePlanId: sceneId, mappingId: late, selectedAssetId: LOGO.id, selectedAssetType: "logo" }
        ],
        1
      );

      // Both frames captured BEFORE either decision is saved - the sequence
      // the dashboard actually produces when a reviewer looks at a scene's
      // slots together, and the one that was impossible before.
      const earlyFrame = await captureEvidenceFrame({ slotMappingId: early, capturedAtSeconds: 1 });
      const lateFrame = await captureEvidenceFrame({ slotMappingId: late, capturedAtSeconds: 4 });

      const decided = await edit(
        [
          { type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId: early, decision: "ACCEPT", evidenceFrameStorageKey: earlyFrame },
          { type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId: late, decision: "ACCEPT", evidenceFrameStorageKey: lateFrame }
        ],
        2
      );

      const mappings = decided.plan.scenePlans[0]?.mappings ?? [];
      expect(mappings.find((mapping) => mapping.id === early)?.slotReview?.evidenceFrameStorageKey).toBe(earlyFrame);
      expect(mappings.find((mapping) => mapping.id === late)?.slotReview?.evidenceFrameStorageKey).toBe(lateFrame);
      expect((await approve(3)).plan.status).toBe("APPROVED");
    });

    it("a capture for one slot does not invalidate the frame another slot's decision names", async () => {
      const { sceneId, mappingIdFor, edit, captureEvidenceFrame } = await setup(twoSlots(), [LOGO]);
      const early = mappingIdFor("ph-early");
      const late = mappingIdFor("ph-late");
      await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: early, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);

      const earlyFrame = await captureEvidenceFrame({ slotMappingId: early, capturedAtSeconds: 1 });
      await captureEvidenceFrame({ slotMappingId: late, capturedAtSeconds: 4 });

      const decided = await edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId: early, decision: "ACCEPT", evidenceFrameStorageKey: earlyFrame }], 2);
      expect(decided.plan.scenePlans[0]?.mappings.find((mapping) => mapping.id === early)?.slotReview?.decision).toBe("ACCEPT");
    });

    it("refuses a frame captured for a DIFFERENT slot - it proves something about that slot, not this one", async () => {
      const { sceneId, mappingIdFor, edit, captureEvidenceFrame } = await setup(twoSlots(), [LOGO]);
      const early = mappingIdFor("ph-early");
      const late = mappingIdFor("ph-late");
      await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: early, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);

      const otherSlotFrame = await captureEvidenceFrame({ slotMappingId: late, capturedAtSeconds: 4 });
      await expect(
        edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId: early, decision: "ACCEPT", evidenceFrameStorageKey: otherSlotFrame }], 2)
      ).rejects.toThrow(/most recent captured frame/);
    });

    it("still refuses a frame this slot's own later capture superseded", async () => {
      const { sceneId, mappingIdFor, edit, captureEvidenceFrame } = await setup(twoSlots(), [LOGO]);
      const early = mappingIdFor("ph-early");
      await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: early, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);

      const superseded = await captureEvidenceFrame({ slotMappingId: early, capturedAtSeconds: 1 });
      const current = await captureEvidenceFrame({ slotMappingId: early, capturedAtSeconds: 1 });

      // Staleness WITHIN a slot is exactly as strict as it always was: the
      // reviewer is looking at the newer frame, so a decision naming the older
      // one is about a picture nobody is looking at any more.
      await expect(
        edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId: early, decision: "ACCEPT", evidenceFrameStorageKey: superseded }], 2)
      ).rejects.toThrow(/most recent captured frame/);
      const decided = await edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId: early, decision: "ACCEPT", evidenceFrameStorageKey: current }], 2);
      expect(decided.plan.scenePlans[0]?.mappings.find((mapping) => mapping.id === early)?.slotReview?.decision).toBe("ACCEPT");
    });

    it("still refuses a frame from this slot's own capture that shows a moment it is not on screen", async () => {
      const { sceneId, mappingIdFor, edit, captureEvidenceFrame } = await setup(twoSlots(), [LOGO]);
      const late = mappingIdFor("ph-late");
      await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: late, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);

      // Attributed to the right slot, but showing the OTHER slot's moment -
      // attribution is a label, and it never replaces the window check.
      const wrongMoment = await captureEvidenceFrame({ slotMappingId: late, capturedAtSeconds: 1 });
      await expect(
        edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId: late, decision: "ACCEPT", evidenceFrameStorageKey: wrongMoment }], 2)
      ).rejects.toThrow(/does not show a moment this slot is on screen/);
    });

    it("still decides a slot from a frame captured before slot attribution existed", async () => {
      const { sceneId, mappingIdFor, edit, captureEvidenceFrame } = await setup(twoSlots(), [LOGO]);
      const early = mappingIdFor("ph-early");
      const late = mappingIdFor("ph-late");
      await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: early, selectedAssetId: LOGO.id, selectedAssetType: "logo" }], 1);

      // An older project's frames carry no slot at all. They stay usable for a
      // slot that has no attributed frame of its own - and a NEWER attributed
      // frame belonging to a different slot does not take that away.
      const legacyFrame = await captureEvidenceFrame({ slotMappingId: null, capturedAtSeconds: 1 });
      await captureEvidenceFrame({ slotMappingId: late, capturedAtSeconds: 4 });

      const decided = await edit([{ type: "SET_SLOT_REVIEW", scenePlanId: sceneId, mappingId: early, decision: "ACCEPT", evidenceFrameStorageKey: legacyFrame }], 2);
      expect(decided.plan.scenePlans[0]?.mappings.find((mapping) => mapping.id === early)?.slotReview?.evidenceFrameStorageKey).toBe(legacyFrame);
    });
  });

  it("does not block a scene the plan excludes from the output", async () => {
    const { sceneId, mappingIdFor, edit, approve } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "a layer", facts: flatCardSlotFacts() }]),
      [SCREENSHOT]
    );
    await edit([{ type: "MAP_ASSET", scenePlanId: sceneId, mappingId: mappingIdFor("ph-1"), selectedAssetId: SCREENSHOT.id, selectedAssetType: "image" }], 1);
    await expect(approve(2)).rejects.toThrow(/unresolved slot findings/i);
    await edit([{ type: "EXCLUDE_SCENE", scenePlanId: sceneId }], 2);
    expect((await approve(3)).plan.status).toBe("APPROVED");
  });
});
