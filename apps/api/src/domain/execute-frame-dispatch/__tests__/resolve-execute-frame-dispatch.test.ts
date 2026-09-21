import { describe, expect, it } from "vitest";
import { assessMappingSlot, classifySlotSemantics, SCHEMA_VERSION, slotEvidenceDigest, SLOT_FINGERPRINT_VERSION, type PlaceholderMapping, type ScenePlanEntry, type SlotStructuralFacts, type TemplateManifest } from "@dyo/schemas";
import { resolveExecuteFrameDispatch, type ExecuteFrameDispatchPlanSnapshot, type ExecuteFrameDispatchSessionSnapshot } from "../resolve-execute-frame-dispatch.js";
import type { SceneEditWorkerSnapshot } from "../../execute-scene-edit/validate-scene-edit-preconditions.js";
import type { AssetRecord } from "../../asset/types.js";

const SHA = "a".repeat(64);
const NOW = new Date("2026-01-01T00:00:00.000Z");
const STALE_AFTER_MS = 30_000;
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const ASSET_ID = "33333333-3333-3333-3333-333333333333";
const WORKER_ID = "44444444-4444-4444-4444-444444444444";
const SESSION_ID = "55555555-5555-5555-5555-555555555555";

/**
 * A confidently-classified FLAT CARD slot: a designer's rectangle, cut by a
 * drawn mask, sitting still in 2D. Present on every image placeholder in these
 * fixtures because Stage 4's slot gate refuses to dispatch an image mapping
 * whose slot was never structurally inspected - that refusal has its own tests
 * below, and is not what the rest of this file is about.
 */
function cardSlotFacts(overrides: Partial<SlotStructuralFacts> = {}): SlotStructuralFacts {
  return {
    slotCompositionId: "slot-comp",
    slotLayerIndex: 1,
    slotLayerName: null,
    slotCompositionName: null,
    widthPx: 800,
    heightPx: 600,
    hostDepth: 1,
    hosts: [
      {
        compositionId: "host-comp",
        layerIndex: 3,
        layerName: null,
        threeDLayer: false,
        hasTrackMatte: true,
        trackMatteType: "ALPHA",
        matteSource: "DRAWN_MASK_OR_SOLID",
        parentLayerIndex: null,
        parentIsAnimated: false,
        siblingPreRenderedPass: false,
        scalePercent: 100,
        rotationDegrees: 0
      }
    ],
    reusedByHostCount: 1,
    transformedBounds: null,
    visibleWindowSeconds: { startSeconds: 0, endSeconds: 5 },
    ...overrides
  };
}

const CARD_SLOT = { slotFacts: cardSlotFacts(), slotSemantics: classifySlotSemantics(cardSlotFacts()) };

function validManifest(overrides: Partial<TemplateManifest> = {}): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "C:\\vidio agent\\White App Promo (converted).aep", name: "White App Promo (converted).aep", sha256: SHA },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: [
      { compositionId: "comp-1", aeProjectItemIndex: 5, name: "Scene 01", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [
      {
        sceneId: "scene-a",
        displayName: null,
        compositionId: "comp-1",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: [
          {
            placeholderId: "ph-1",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Headline",
            layerIndex: 2,
            layerPath: [],
            placeholderType: "text",
            // The template's own wording for this layer. Present so these
            // dispatch tests are not blocked by the leftover-template-copy
            // gate's "manifest never captured template text" rule, which has
            // its own dedicated tests below.
            originalText: "The template's own wording",
            editable: true,
            sourceType: "TextLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "confirmed via ae_get_composition" }
          },
          {
            placeholderId: "ph-2",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Hero Image",
            layerIndex: 3,
            layerPath: [],
            placeholderType: "image",
            editable: true,
            sourceType: "AVLayer",
            ...CARD_SLOT,
            dimensions: { width: 800, height: 600 },
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "confirmed via ae_get_composition" }
          }
        ]
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: [],
    ...overrides
  };
}

function textMapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Headline",
    placeholderClassification: { value: "text", source: "MANIFEST", evidence: [] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: "Approved Headline",
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    humanLayerIndex: null,
    humanNestedTarget: null,
    mappingSource: "HUMAN",
    confidence: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

function imageMapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-2",
    manifestPlaceholderId: "ph-2",
    placeholderName: "Hero Image",
    placeholderClassification: { value: "image", source: "MANIFEST", evidence: [] },
    selectedAssetId: ASSET_ID,
    selectedAssetType: "image",
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    humanLayerIndex: null,
    humanNestedTarget: null,
    mappingSource: "HUMAN",
    confidence: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

function validScene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "APPROVED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [textMapping()],
    reelsLayout: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

function validPlan(overrides: Partial<ExecuteFrameDispatchPlanSnapshot> = {}): ExecuteFrameDispatchPlanSnapshot {
  return {
    id: "plan-1",
    revision: 2,
    status: "APPROVED",
    sourceProjectSha256: SHA,
    scenePlans: [validScene()],
    ...overrides
  };
}

function validAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: ASSET_ID,
    projectId: PROJECT_ID,
    originalFilename: "hero.jpg",
    storageKey: `${PROJECT_ID}/hero.jpg`,
    mediaKind: "IMAGE",
    mimeType: "image/jpeg",
    byteSize: 1024,
    sha256: "b".repeat(64),
    width: 800,
    height: 600,
    hasAlpha: null,
    durationSeconds: null,
    label: null,
    notes: null,
    uploadedAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function validWorker(overrides: Partial<SceneEditWorkerSnapshot> = {}): SceneEditWorkerSnapshot {
  return {
    id: WORKER_ID,
    status: "ONLINE",
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    capabilities: ["EXECUTE_FRAME"],
    currentJobId: null,
    lastHeartbeatAt: NOW,
    ...overrides
  };
}

function validSession(overrides: Partial<ExecuteFrameDispatchSessionSnapshot> = {}): ExecuteFrameDispatchSessionSnapshot {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    planRevision: 2,
    sourceProjectSha256: SHA,
    assignedWorkerId: WORKER_ID,
    status: "PREPARING",
    latestWorkingProjectSha256: null,
    completedScenePlanIds: [],
    latestPreviewScenePlanId: null,
    workingCopyTrusted: true,
    ...overrides
  };
}

function baseInput(overrides: Partial<Parameters<typeof resolveExecuteFrameDispatch>[0]> = {}) {
  return {
    projectId: PROJECT_ID,
    scenePlanId: "scene-1",
    session: validSession(),
    currentPlan: validPlan(),
    currentProjectManifest: validManifest(),
    projectAssets: [validAsset()],
    worker: validWorker(),
    now: NOW,
    staleAfterMs: STALE_AFTER_MS,
    ...overrides
  };
}

describe("resolveExecuteFrameDispatch - leftover template copy blocks EXECUTION, not only approval", () => {
  it("refuses to dispatch a scene whose text is still the template's own wording", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentPlan: validPlan({ scenePlans: [validScene({ mappings: [textMapping({ text: "The template's own wording" })] })] })
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/unreviewed template copy/i);
  });

  it("refuses a case-only variant of the template's wording", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentPlan: validPlan({ scenePlans: [validScene({ mappings: [textMapping({ text: "THE TEMPLATE'S OWN WORDING" })] })] })
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/letter case/);
  });

  it("dispatches once the reviewer explicitly kept the template wording", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentPlan: validPlan({
          scenePlans: [
            validScene({
              mappings: [
                textMapping({
                  text: "The template's own wording",
                  keepTemplateText: { decision: "KEEP_TEMPLATE_TEXT", decidedBy: "user-1", decidedAt: NOW.toISOString(), textAtDecision: "The template's own wording" }
                })
              ]
            })
          ]
        })
      })
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a scene whose manifest placeholder never captured the template's own text", () => {
    const legacyManifest = validManifest();
    const legacyScene = legacyManifest.scenes[0]!;
    const strippedPlaceholders = legacyScene.placeholders.map(({ originalText: _dropped, ...rest }) => rest);
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentProjectManifest: { ...legacyManifest, scenes: [{ ...legacyScene, placeholders: strippedPlaceholders }] }
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/re-run template inspection/);
  });
});

describe("resolveExecuteFrameDispatch - slot semantics and fit block EXECUTION, not only approval", () => {
  /** Replaces the scene's image placeholder with one carrying the given structure (or none at all). */
  function manifestWithSlot(facts: SlotStructuralFacts | null): TemplateManifest {
    const base = validManifest();
    const scene = base.scenes[0]!;
    const placeholders = scene.placeholders.map((placeholder) => {
      if (placeholder.placeholderId !== "ph-2") {
        return placeholder;
      }
      const { slotFacts: _dropped, slotSemantics: _alsoDropped, ...bare } = placeholder;
      return facts === null ? bare : { ...bare, slotFacts: facts, slotSemantics: classifySlotSemantics(facts) };
    });
    return { ...base, scenes: [{ ...scene, placeholders }] };
  }

  const withImageMapping = (manifest: TemplateManifest, assets = [validAsset()]) =>
    resolveExecuteFrameDispatch(
      baseInput({
        currentProjectManifest: manifest,
        projectAssets: assets,
        currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping()] })] })
      })
    );

  it("refuses to dispatch an image mapping whose slot was never structurally inspected", () => {
    const result = withImageMapping(manifestWithSlot(null));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/re-run template inspection/);
  });

  it("refuses to dispatch while a slot's classification is uncertain", () => {
    const conflicting = cardSlotFacts({
      hosts: [{ ...cardSlotFacts().hosts[0]!, threeDLayer: true, parentLayerIndex: 4, parentIsAnimated: true }]
    });
    const result = withImageMapping(manifestWithSlot(conflicting));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/SLOT_CLASSIFICATION_UNCERTAIN/);
  });

  it("refuses to dispatch an asset that does not belong in the slot it is mapped to", () => {
    const screenFacts = cardSlotFacts({
      widthPx: 1080,
      heightPx: 2160,
      hosts: [
        {
          ...cardSlotFacts().hosts[0]!,
          threeDLayer: true,
          matteSource: "RENDERED_FOOTAGE",
          parentLayerIndex: 2,
          parentIsAnimated: true,
          siblingPreRenderedPass: true
        }
      ]
    });
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentProjectManifest: manifestWithSlot(screenFacts),
        projectAssets: [validAsset({ width: 1080, height: 2160, hasAlpha: true })],
        currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping({ selectedAssetType: "logo" })] })] })
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/ASSET_SLOT_CONFLICT/);
  });

  it("refuses to dispatch a fit that would cut most of the asset away", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentProjectManifest: manifestWithSlot(cardSlotFacts({ widthPx: 400, heightPx: 2000 })),
        projectAssets: [validAsset({ width: 4000, height: 400 })],
        currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping()] })] })
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/UNSAFE_FIT/);
  });

  it("dispatches once the reviewer explicitly decided about those exact findings", () => {
    const manifest = manifestWithSlot(cardSlotFacts({ widthPx: 400, heightPx: 2000 }));
    const asset = validAsset({ width: 4000, height: 400 });
    const blocked = resolveExecuteFrameDispatch(
      baseInput({
        currentProjectManifest: manifest,
        projectAssets: [asset],
        currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping()] })] })
      })
    );
    expect(blocked.ok).toBe(false);

    const scene = validScene({ mappings: [imageMapping()] });
    const digest = slotEvidenceDigest(
      assessMappingSlot({
        scene,
        mapping: scene.mappings[0]!,
        manifest,
        asset: { id: asset.id, widthPx: asset.width, heightPx: asset.height, hasAlpha: asset.hasAlpha }
      })
    );
    const decided = resolveExecuteFrameDispatch(
      baseInput({
        currentProjectManifest: manifest,
        projectAssets: [asset],
        currentPlan: validPlan({
          scenePlans: [
            validScene({
              mappings: [
                imageMapping({
                  slotReview: {
                    decision: "ACCEPT",
                    classification: null,
                    decidedBy: "user-1",
                    decidedAt: NOW.toISOString(),
                    evidenceDigest: digest,
                    evidenceFrameStorageKey: "evidence/frame.png"
                  }
                })
              ]
            })
          ]
        })
      })
    );
    expect(decided.ok).toBe(true);
  });

  it("carries the slot's mutation fingerprint to the worker so the structure is re-proved before the edit", () => {
    const base = validManifest();
    const scene = base.scenes[0]!;
    const fingerprint = { version: SLOT_FINGERPRINT_VERSION, digest: "f".repeat(64) };
    const manifest: TemplateManifest = {
      ...base,
      scenes: [
        {
          ...scene,
          placeholders: scene.placeholders.map((placeholder) =>
            placeholder.placeholderId === "ph-2" ? { ...placeholder, slotMutationFingerprint: fingerprint } : placeholder
          )
        }
      ]
    };
    const result = withImageMapping(manifest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations[0]).toMatchObject({ type: "MAP_FOOTAGE", expectedSlotFingerprint: fingerprint });
  });
});

describe("resolveExecuteFrameDispatch", () => {
  it("succeeds and derives the real composition identity + SET_TEXT operation from the approved mapping", () => {
    const result = resolveExecuteFrameDispatch(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.manifestCompositionId).toBe("comp-1");
    expect(result.payload.aeProjectItemIndex).toBe(5);
    expect(result.payload.compositionName).toBe("Scene 01");
    expect(result.payload.sourceProjectPath).toBe("C:\\vidio agent\\White App Promo (converted).aep");
    expect(result.payload.operations).toEqual([{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 2, nestedTarget: null, text: "Approved Headline" }]);
    expect(result.payload.approvedMappingIds).toEqual(["mapping-1"]);
    expect(result.payload.executionSessionId).toBe(SESSION_ID);
    expect(result.payload.expectedWorkingProjectSha256).toBeNull();
  });

  it("appends BUILD_REELS_COMPOSITION as the LAST operation when the scene has an approved reelsLayout - 2026-08-29 closure requirement", () => {
    const reelsLayout = {
      reelsCompositionName: "Scene 01 - Reels",
      layerTransforms: [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }],
      configuredAt: "2026-08-29T00:00:00.000Z"
    };
    const result = resolveExecuteFrameDispatch(baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ reelsLayout })] }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations.at(-1)).toEqual({
      type: "BUILD_REELS_COMPOSITION",
      reelsCompositionName: "Scene 01 - Reels",
      layerTransforms: reelsLayout.layerTransforms
    });
    // Content operations still come first - the duplicate is built from
    // the already-edited landscape composition, never from stale template
    // placeholder content.
    expect(result.payload.operations[0]).toEqual({ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 2, nestedTarget: null, text: "Approved Headline" });
  });

  it("never appends BUILD_REELS_COMPOSITION when the scene has no reelsLayout configured - fully additive, landscape-only by default", () => {
    const result = resolveExecuteFrameDispatch(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations.some((operation) => operation.type === "BUILD_REELS_COMPOSITION")).toBe(false);
  });

  it("carries the session's own latestWorkingProjectSha256 as expectedWorkingProjectSha256 for a session's SECOND scene job", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: validSession({ latestWorkingProjectSha256: "d".repeat(64), completedScenePlanIds: ["scene-0"] }) })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.expectedWorkingProjectSha256).toBe("d".repeat(64));
  });

  it("resolves a MAP_FOOTAGE intent from an asset-classified mapping - assetId/expectedSha256/mimeType come from the real Asset Catalog, never a caller-supplied path", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping()] })] }) })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([
      { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-2", layerIndex: 3, nestedTarget: null, assetId: ASSET_ID, expectedSha256: "b".repeat(64), mimeType: "image/jpeg" }
    ]);
  });

  it("real 2026-09-16: a mapping approved as a logo asks the worker to fit the whole logo inside its card (contain); other assets keep the default cover fit", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping({ selectedAssetType: "logo" })] })] }) })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([
      { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-2", layerIndex: 3, nestedTarget: null, assetId: ASSET_ID, expectedSha256: "b".repeat(64), mimeType: "image/jpeg", fit: "contain" }
    ]);
  });

  it("fails when no plan exists", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ currentPlan: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No execution plan exists");
  });

  it("fails when the plan is not APPROVED", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ currentPlan: validPlan({ status: "DRAFT" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not APPROVED");
  });

  it("fails when the project's current manifest sha256 no longer matches the plan's own", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ currentProjectManifest: validManifest({ sourceProject: { path: "x", name: "x", sha256: "c".repeat(64) } }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no longer matches");
  });

  it("fails when the scenePlanId is unknown", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ scenePlanId: "does-not-exist" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Unknown scenePlanId");
  });

  it("fails when the scene is excluded (use=false)", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ use: false })] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("excluded");
  });

  it("fails when the scene is not APPROVED", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ approvalState: "UNREVIEWED" })] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not APPROVED");
  });

  it("fails when the scene has unresolved reasons", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ unresolvedReasons: ["no confident structural classification"] })] }) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("unresolved reasons");
  });

  it("fails when manifestCompositionId no longer matches any real composition", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ manifestCompositionId: "does-not-exist" })] }) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not match any composition");
  });

  it("resolves a SET_BRAND_COLOR operation from a color-classified mapping's own approved colorHex", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentPlan: validPlan({
          scenePlans: [
            validScene({
              mappings: [textMapping({ placeholderClassification: { value: "color", source: "MANIFEST", evidence: [] }, colorHex: "#1A2B3C" })]
            })
          ]
        })
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([{ type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 2, colorHex: "#1A2B3C" }]);
  });

  it("fails closed when a mapping is classified as color but has no colorHex set - no fabricated default", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentPlan: validPlan({
          scenePlans: [validScene({ mappings: [textMapping({ placeholderClassification: { value: "color", source: "MANIFEST", evidence: [] } })] })]
        })
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("colorHex");
  });

  it("resolves SET_LAYER_VISIBILITY/SET_TIME_REMAP_FREEZE/SET_LAYER_DURATION as independent overrides, additional to the mapping's own primary (text) operation", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentPlan: validPlan({
          scenePlans: [validScene({ mappings: [textMapping({ layerVisible: false, freezeAtSeconds: 2.5, layerDurationSeconds: 4 })] })]
        })
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 2, nestedTarget: null, text: "Approved Headline" },
      { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 2, visible: false },
      { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-1", layerIndex: 2, freezeAtSeconds: 2.5 },
      { type: "SET_DURATION", manifestPlaceholderId: "ph-1", layerIndex: 2, durationSeconds: 4 }
    ]);
    // The mapping is still counted exactly once, never duplicated.
    expect(result.payload.approvedMappingIds).toEqual(["mapping-1"]);
  });

  it("never emits SET_LAYER_VISIBILITY/SET_TIME_REMAP_FREEZE/SET_DURATION when the operator never set them - no fabricated overrides", () => {
    const result = resolveExecuteFrameDispatch(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 2, nestedTarget: null, text: "Approved Headline" }]);
  });

  it("resolves a visibility-only override on a mapping with no other resolvable classification, so the scene is still dispatchable", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentPlan: validPlan({
          scenePlans: [
            validScene({
              mappings: [textMapping({ placeholderClassification: { value: null, source: "MANIFEST", evidence: [] }, text: null, layerVisible: true })]
            })
          ]
        })
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([{ type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 2, visible: true }]);
  });

  it("treats a pre-existing plan row missing colorHex/layerVisible/freezeAtSeconds/layerDurationSeconds entirely (predating this schema addition) the same as explicit null - never a fabricated SET_LAYER_VISIBILITY(visible: undefined) etc.", () => {
    const legacyMapping = textMapping();
    // Simulates a real DB row's scenePlans jsonb blob persisted before these
    // four fields existed - the keys are genuinely ABSENT, not merely null.
    delete (legacyMapping as Partial<PlaceholderMapping>).colorHex;
    delete (legacyMapping as Partial<PlaceholderMapping>).layerVisible;
    delete (legacyMapping as Partial<PlaceholderMapping>).freezeAtSeconds;
    delete (legacyMapping as Partial<PlaceholderMapping>).layerDurationSeconds;

    const result = resolveExecuteFrameDispatch(baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ mappings: [legacyMapping] })] }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 2, nestedTarget: null, text: "Approved Headline" }]);
  });

  it("fails when an asset-classified mapping has no selectedAssetId", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping({ selectedAssetId: null })] })] }) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no selectedAssetId set");
  });

  it("fails when the selected asset no longer exists in the Asset Catalog", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping()] })] }), projectAssets: [] })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no longer exists");
  });

  it("silently excludes a human-added mapping with no manifestPlaceholderId, rather than failing the whole scene", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        currentPlan: validPlan({
          scenePlans: [validScene({ mappings: [textMapping(), textMapping({ id: "mapping-extra", manifestPlaceholderId: null })] })]
        })
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toHaveLength(1);
    expect(result.payload.approvedMappingIds).toEqual(["mapping-1"]);
  });

  // Live QA execution-wiring fix (2026-09-08): a human-added mapping WITH
  // a real, verified AE layer target (humanLayerIndex/humanNestedTarget)
  // is now translated into a REAL dispatchable operation - the executor
  // fully supports both direct and nested human targets. These replace
  // the earlier "fails closed, not yet implemented" tests.
  describe("human-added mappings with a real, verified AE target (humanLayerIndex/humanNestedTarget)", () => {
    it("direct humanLayerIndex still works: resolves a real SET_TEXT operation addressed within the scene's own composition, manifestPlaceholderId: null", () => {
      const result = resolveExecuteFrameDispatch(
        baseInput({
          currentPlan: validPlan({
            scenePlans: [
              validScene({
                mappings: [
                  textMapping({
                    id: "mapping-human-text",
                    manifestPlaceholderId: null,
                    humanLayerIndex: 7,
                    mappingSource: "HUMAN"
                  })
                ]
              })
            ]
          })
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.operations).toEqual([
        { type: "SET_TEXT", manifestPlaceholderId: null, layerIndex: 7, nestedTarget: null, text: "Approved Headline" }
      ]);
      expect(result.payload.approvedMappingIds).toEqual(["mapping-human-text"]);
    });

    it("direct humanLayerIndex works for an asset (logo) classification too - real MAP_FOOTAGE operation", () => {
      const result = resolveExecuteFrameDispatch(
        baseInput({
          currentPlan: validPlan({
            scenePlans: [
              validScene({
                mappings: [
                  imageMapping({
                    id: "mapping-human-logo-direct",
                    manifestPlaceholderId: null,
                    placeholderClassification: { value: "logo", source: "HUMAN", evidence: [] },
                    humanLayerIndex: 9,
                    mappingSource: "HUMAN"
                  })
                ]
              })
            ]
          })
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.operations).toEqual([
        { type: "MAP_FOOTAGE", manifestPlaceholderId: null, layerIndex: 9, nestedTarget: null, assetId: ASSET_ID, expectedSha256: "b".repeat(64), mimeType: "image/jpeg" }
      ]);
    });

    /** A real, 3-hop nested manifest graph shaped exactly like the live App Logo chain (!Render > Scene 1 > Pre-comp 3 > App Logo). */
    function nestedManifest(): TemplateManifest {
      return validManifest({
        compositions: [
          { compositionId: "comp-1", aeProjectItemIndex: 5, name: "Scene 01", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
          { compositionId: "comp-precomp", aeProjectItemIndex: 11, name: "Pre-comp 3", widthPx: 400, heightPx: 400, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-1"] },
          { compositionId: "comp-logo", aeProjectItemIndex: 22, name: "App Logo", widthPx: 200, heightPx: 200, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-precomp"] }
        ]
      });
    }

    it("multi-hop traversal: resolves a real, multi-step nestedTarget into a MAP_FOOTAGE operation with each step's own real aeProjectItemIndex resolved fresh from the manifest - nested logo asset replacement", () => {
      const humanNestedTarget = [
        { compositionId: "comp-precomp", layerIndex: 4 },
        { compositionId: "comp-logo", layerIndex: 1 }
      ];
      const result = resolveExecuteFrameDispatch(
        baseInput({
          currentProjectManifest: nestedManifest(),
          currentPlan: validPlan({
            scenePlans: [
              validScene({
                mappings: [
                  imageMapping({
                    id: "mapping-nested-logo",
                    manifestPlaceholderId: null,
                    placeholderClassification: { value: "logo", source: "HUMAN", evidence: [] },
                    humanLayerIndex: null,
                    humanNestedTarget,
                    mappingSource: "HUMAN"
                  })
                ]
              })
            ]
          })
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.operations).toEqual([
        {
          type: "MAP_FOOTAGE",
          manifestPlaceholderId: null,
          layerIndex: null,
          nestedTarget: [
            { compositionId: "comp-precomp", aeProjectItemIndex: 11, layerIndex: 4 },
            { compositionId: "comp-logo", aeProjectItemIndex: 22, layerIndex: 1 }
          ],
          assetId: ASSET_ID,
          expectedSha256: "b".repeat(64),
          mimeType: "image/jpeg"
        }
      ]);
      expect(result.payload.approvedMappingIds).toEqual(["mapping-nested-logo"]);
    });

    it("nested text sourceText replacement: resolves a real, multi-step nestedTarget into a SET_TEXT operation", () => {
      const humanNestedTarget = [
        { compositionId: "comp-precomp", layerIndex: 4 },
        { compositionId: "comp-logo", layerIndex: 1 }
      ];
      const result = resolveExecuteFrameDispatch(
        baseInput({
          currentProjectManifest: nestedManifest(),
          currentPlan: validPlan({
            scenePlans: [
              validScene({
                mappings: [
                  textMapping({
                    id: "mapping-nested-text",
                    manifestPlaceholderId: null,
                    text: "מבית DYO App",
                    humanLayerIndex: null,
                    humanNestedTarget,
                    mappingSource: "HUMAN"
                  })
                ]
              })
            ]
          })
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.operations).toEqual([
        {
          type: "SET_TEXT",
          manifestPlaceholderId: null,
          layerIndex: null,
          nestedTarget: [
            { compositionId: "comp-precomp", aeProjectItemIndex: 11, layerIndex: 4 },
            { compositionId: "comp-logo", aeProjectItemIndex: 22, layerIndex: 1 }
          ],
          text: "מבית DYO App"
        }
      ]);
    });

    it("stale/broken path fails closed: a nestedTarget step whose compositionId is no longer a real child (manifest changed since the mapping was added) fails the whole scene, never silently skips or guesses", () => {
      // comp-logo's parent is reassigned away from comp-precomp - the exact
      // "the template's real structure changed since this was verified"
      // scenario this must fail closed on.
      const brokenManifest = validManifest({
        compositions: [
          { compositionId: "comp-1", aeProjectItemIndex: 5, name: "Scene 01", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
          { compositionId: "comp-precomp", aeProjectItemIndex: 11, name: "Pre-comp 3", widthPx: 400, heightPx: 400, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-1"] },
          { compositionId: "comp-logo", aeProjectItemIndex: 22, name: "App Logo", widthPx: 200, heightPx: 200, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-1"] }
        ]
      });
      const result = resolveExecuteFrameDispatch(
        baseInput({
          currentProjectManifest: brokenManifest,
          currentPlan: validPlan({
            scenePlans: [
              validScene({
                mappings: [
                  imageMapping({
                    id: "mapping-stale-logo",
                    manifestPlaceholderId: null,
                    placeholderClassification: { value: "logo", source: "HUMAN", evidence: [] },
                    humanLayerIndex: null,
                    humanNestedTarget: [
                      { compositionId: "comp-precomp", layerIndex: 4 },
                      { compositionId: "comp-logo", layerIndex: 1 }
                    ],
                    mappingSource: "HUMAN"
                  })
                ]
              })
            ]
          })
        })
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("mapping-stale-logo");
      expect(result.reason).toContain("not a real child");
    });

    it("wrong composition/layer fails closed: a nestedTarget step referencing a compositionId that no longer exists in the current manifest at all fails the whole scene", () => {
      const result = resolveExecuteFrameDispatch(
        baseInput({
          currentProjectManifest: nestedManifest(),
          currentPlan: validPlan({
            scenePlans: [
              validScene({
                mappings: [
                  imageMapping({
                    id: "mapping-vanished-logo",
                    manifestPlaceholderId: null,
                    placeholderClassification: { value: "logo", source: "HUMAN", evidence: [] },
                    humanLayerIndex: null,
                    humanNestedTarget: [
                      { compositionId: "comp-precomp", layerIndex: 4 },
                      { compositionId: "comp-does-not-exist", layerIndex: 1 }
                    ],
                    mappingSource: "HUMAN"
                  })
                ]
              })
            ]
          })
        })
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("mapping-vanished-logo");
      expect(result.reason).toContain("does not exist in the current manifest");
    });

    it("fails closed when a human-added mapping has a real target but an unsupported classification", () => {
      const result = resolveExecuteFrameDispatch(
        baseInput({
          currentPlan: validPlan({
            scenePlans: [
              validScene({
                mappings: [
                  textMapping({
                    id: "mapping-human-color",
                    manifestPlaceholderId: null,
                    placeholderClassification: { value: "color", source: "HUMAN", evidence: [] },
                    text: null,
                    humanLayerIndex: 3,
                    mappingSource: "HUMAN"
                  })
                ]
              })
            ]
          })
        })
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("mapping-human-color");
      expect(result.reason).toContain("unsupported placeholderClassification");
    });

    it("existing manifest-linked mappings are completely unchanged alongside a human-added one in the SAME scene", () => {
      const result = resolveExecuteFrameDispatch(
        baseInput({
          currentProjectManifest: nestedManifest(),
          currentPlan: validPlan({
            scenePlans: [
              validScene({
                mappings: [
                  textMapping(),
                  imageMapping({
                    id: "mapping-nested-logo",
                    manifestPlaceholderId: null,
                    placeholderClassification: { value: "logo", source: "HUMAN", evidence: [] },
                    humanLayerIndex: null,
                    humanNestedTarget: [
                      { compositionId: "comp-precomp", layerIndex: 4 },
                      { compositionId: "comp-logo", layerIndex: 1 }
                    ],
                    mappingSource: "HUMAN"
                  })
                ]
              })
            ]
          })
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.operations).toEqual([
        { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 2, nestedTarget: null, text: "Approved Headline" },
        {
          type: "MAP_FOOTAGE",
          manifestPlaceholderId: null,
          layerIndex: null,
          nestedTarget: [
            { compositionId: "comp-precomp", aeProjectItemIndex: 11, layerIndex: 4 },
            { compositionId: "comp-logo", aeProjectItemIndex: 22, layerIndex: 1 }
          ],
          assetId: ASSET_ID,
          expectedSha256: "b".repeat(64),
          mimeType: "image/jpeg"
        }
      ]);
      expect(result.payload.approvedMappingIds).toEqual(["mapping-1", "mapping-nested-logo"]);
    });
  });

  it("fails when a scene has zero resolvable operations", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ mappings: [textMapping({ manifestPlaceholderId: null })] })] }) })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no resolvable operations");
  });

  it("fails when the worker has never reported in", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ worker: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("never reported in");
  });

  it("fails when AE is not ONLINE", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ worker: validWorker({ aeStatus: "OFFLINE" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("AE is not ONLINE");
  });

  it("fails when MCP is not ONLINE", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ worker: validWorker({ mcpStatus: "OFFLINE" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("MCP is not ONLINE");
  });

  it("fails when the worker does not report the EXECUTE_FRAME capability", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ worker: validWorker({ capabilities: [] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("EXECUTE_FRAME");
  });

  it("fails when the worker already has a job in progress", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ worker: validWorker({ currentJobId: "job-1" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("already has a job in progress");
  });

  it("fails when no execution session exists for the requested executionSessionId", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No execution session was found");
  });

  it("fails when the session belongs to a different project", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: validSession({ projectId: "99999999-9999-9999-9999-999999999999" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not belong to this project");
  });

  it("fails when the session is already terminal (COMPLETED/FAILED) - a new session is required", () => {
    for (const status of ["COMPLETED", "FAILED"] as const) {
      const result = resolveExecuteFrameDispatch(baseInput({ session: validSession({ status }) }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("start a new execution session");
    }
  });

  it("fails when this exact scene has already been edited in this session - never a double-edit", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: validSession({ completedScenePlanIds: ["scene-1"] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("already been edited in this execution session");
  });

  it("fails when the session's own bound planRevision no longer matches the current plan - never silently applies a changed plan to an existing session", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: validSession({ planRevision: 1 }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("start a new execution session");
  });

  it("fails when the session's own bound sourceProjectSha256 no longer matches the current plan", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: validSession({ sourceProjectSha256: "c".repeat(64) }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("start a new execution session");
  });

  it("fails when the dispatched worker is not the session's own assignedWorkerId - worker affinity", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ worker: validWorker({ id: "66666666-6666-6666-6666-666666666666" }) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("pinned to a different worker");
  });

  it("never accepts a raw assetPath/aeProjectItemIndex/compositionName from the caller - the function's own input type has no such field", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ currentPlan: validPlan({ scenePlans: [validScene({ mappings: [imageMapping()] })] }) })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Every MAP_FOOTAGE operation carries assetId/expectedSha256/mimeType only - never assetPath.
    for (const operation of result.payload.operations) {
      if (operation.type === "MAP_FOOTAGE") {
        expect(operation).not.toHaveProperty("assetPath");
      }
    }
  });
});

describe("resolveExecuteFrameDispatch - regeneratePreviewOnly (First Preview regeneration, live QA 2026-09-08/09)", () => {
  const MUTATED_SHA = "d".repeat(64);

  function regeneratableSession(overrides: Partial<ExecuteFrameDispatchSessionSnapshot> = {}): ExecuteFrameDispatchSessionSnapshot {
    return validSession({
      status: "FAILED",
      completedScenePlanIds: ["scene-1"],
      latestWorkingProjectSha256: MUTATED_SHA,
      latestPreviewScenePlanId: "scene-1",
      ...overrides
    });
  }

  it("allows a FAILED session with real completed work to regenerate - the exact rejected-preview recovery case", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: regeneratableSession(), regeneratePreviewOnly: true, previewTimestampSeconds: 3 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([]);
    expect(result.payload.approvedMappingIds).toEqual([]);
    expect(result.payload.previewOnly).toBe(true);
    expect(result.payload.previewTimestampSeconds).toBe(3);
    expect(result.payload.expectedWorkingProjectSha256).toBe(MUTATED_SHA);
    expect(result.payload.scenePlanId).toBe("scene-1");
  });

  it("allows an AWAITING_PREVIEW_APPROVAL session to regenerate before ever being rejected", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: regeneratableSession({ status: "AWAITING_PREVIEW_APPROVAL" }), regeneratePreviewOnly: true })
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a FAILED session with no completed scenes - a genuine chain-of-custody/other failure, never treated as recoverable", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        session: validSession({ status: "FAILED", completedScenePlanIds: [], latestWorkingProjectSha256: null, latestPreviewScenePlanId: null }),
        regeneratePreviewOnly: true
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not have a recoverable First Preview");
  });

  it("refuses a FAILED session with completed scenes but no working copy hash recorded", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: regeneratableSession({ latestWorkingProjectSha256: null }), regeneratePreviewOnly: true })
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a COMPLETED session - never a general un-fail-any-session escape hatch", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: regeneratableSession({ status: "COMPLETED" }), regeneratePreviewOnly: true }));
    expect(result.ok).toBe(false);
  });

  /**
   * The exact 2026-09-09 regression (session 5040ce97): every OTHER field
   * still looks perfectly recoverable after a previewOnly run discovers
   * WORKING_COPY_UNEXPECTEDLY_MUTATED - workingCopyTrusted is the one
   * signal that must permanently exclude it anyway.
   */
  it("refuses a session whose workingCopyTrusted has been set false, even though every other field still looks recoverable", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: regeneratableSession({ workingCopyTrusted: false }), regeneratePreviewOnly: true })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not have a recoverable First Preview");
  });

  it("refuses when the caller's scenePlanId does not match the session's own latestPreviewScenePlanId - never a caller-chosen target", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ scenePlanId: "some-other-scene", session: regeneratableSession(), regeneratePreviewOnly: true })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not match this session's own last-previewed scene");
  });

  it("refuses a stale plan revision, exactly like the normal edit path", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: regeneratableSession({ planRevision: 1 }), currentPlan: validPlan({ revision: 2 }), regeneratePreviewOnly: true })
    );
    expect(result.ok).toBe(false);
  });

  it("refuses an offline worker, exactly like the normal edit path", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: regeneratableSession(), worker: validWorker({ status: "OFFLINE" }), regeneratePreviewOnly: true })
    );
    expect(result.ok).toBe(false);
  });

  it("never produces a real edit operation - operations/approvedMappingIds are always empty regardless of the scene's own real mappings", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        session: regeneratableSession(),
        currentPlan: validPlan({ scenePlans: [validScene({ mappings: [textMapping(), imageMapping()] })] }),
        regeneratePreviewOnly: true
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toHaveLength(0);
    expect(result.payload.approvedMappingIds).toHaveLength(0);
  });
});

describe("resolveExecuteFrameDispatch - buildHorizontalCompositionOnly (Landscape output-composition build, live QA 2026-09-10 urgent request)", () => {
  const MUTATED_SHA = "d".repeat(64);

  function readyToBuildSession(overrides: Partial<ExecuteFrameDispatchSessionSnapshot> = {}): ExecuteFrameDispatchSessionSnapshot {
    return validSession({
      status: "READY_TO_RENDER",
      completedScenePlanIds: ["scene-1"],
      latestWorkingProjectSha256: MUTATED_SHA,
      ...overrides
    });
  }

  it("real session shape (a7fee3d9): a scene already completed in this session produces a single, self-sufficient BUILD_HORIZONTAL_COMPOSITION operation, never bundled with any content edit", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: readyToBuildSession(), buildHorizontalCompositionOnly: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([{ type: "BUILD_HORIZONTAL_COMPOSITION", horizontalCompositionName: "Scene 01 (Landscape)" }]);
    expect(result.payload.approvedMappingIds).toEqual([]);
    expect(result.payload.expectedWorkingProjectSha256).toBe(MUTATED_SHA);
    expect(result.payload.scenePlanId).toBe("scene-1");
    expect(result.payload.aeProjectItemIndex).toBe(5);
    expect(result.payload.compositionName).toBe("Scene 01");
  });

  it("the new composition's name is ALWAYS server-derived from the scene's own real, current composition name - never a caller-supplied string", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        session: readyToBuildSession(),
        currentProjectManifest: validManifest({
          compositions: [{ compositionId: "comp-1", aeProjectItemIndex: 5, name: "!Render", widthPx: 1080, heightPx: 1920, durationSeconds: 45, frameRate: 29.97, isNestedOnlyReferenced: false, parentCompositionIds: [] }]
        }),
        buildHorizontalCompositionOnly: true
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([{ type: "BUILD_HORIZONTAL_COMPOSITION", horizontalCompositionName: "!Render (Landscape)" }]);
  });

  it("requires the target scene to already be in the session's own completedScenePlanIds - the OPPOSITE precondition of a normal edit dispatch", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: readyToBuildSession({ completedScenePlanIds: [] }), buildHorizontalCompositionOnly: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("has not been executed in this session yet");
  });

  it("refuses when the session has no recorded working copy at all", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: readyToBuildSession({ latestWorkingProjectSha256: null }), buildHorizontalCompositionOnly: true }));
    expect(result.ok).toBe(false);
  });

  it("refuses a FAILED session - never a general un-fail-any-session escape hatch", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: readyToBuildSession({ status: "FAILED" }), buildHorizontalCompositionOnly: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("start a new execution session");
  });

  it("refuses a COMPLETED session", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: readyToBuildSession({ status: "COMPLETED" }), buildHorizontalCompositionOnly: true }));
    expect(result.ok).toBe(false);
  });

  it("refuses when the session's own workingCopyTrusted has been set false", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: readyToBuildSession({ workingCopyTrusted: false }), buildHorizontalCompositionOnly: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no longer trusted");
  });

  it("refuses a stale plan revision, exactly like every other dispatch branch", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: readyToBuildSession({ planRevision: 1 }), currentPlan: validPlan({ revision: 2 }), buildHorizontalCompositionOnly: true })
    );
    expect(result.ok).toBe(false);
  });

  it("refuses when the plan is not APPROVED", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({ session: readyToBuildSession(), currentPlan: validPlan({ status: "DRAFT" }), buildHorizontalCompositionOnly: true })
    );
    expect(result.ok).toBe(false);
  });

  it("refuses an offline worker, exactly like every other dispatch branch", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: readyToBuildSession(), worker: validWorker({ status: "OFFLINE" }), buildHorizontalCompositionOnly: true }));
    expect(result.ok).toBe(false);
  });

  it("refuses a worker pinned to a different session (worker affinity)", () => {
    const result = resolveExecuteFrameDispatch(baseInput({ session: readyToBuildSession(), worker: validWorker({ id: "other-worker" }), buildHorizontalCompositionOnly: true }));
    expect(result.ok).toBe(false);
  });

  it("never touches operations/approvedMappingIds derived from the scene's own real mappings - a comp-level operation regardless of how many mappings exist", () => {
    const result = resolveExecuteFrameDispatch(
      baseInput({
        session: readyToBuildSession(),
        currentPlan: validPlan({ scenePlans: [validScene({ mappings: [textMapping(), imageMapping()] })] }),
        buildHorizontalCompositionOnly: true
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toHaveLength(1);
    expect(result.payload.approvedMappingIds).toHaveLength(0);
  });
});

/**
 * Nested manifest placeholders (2026-09-13). Inspection now surfaces editable
 * layers found INSIDE precomps. Their layerIndex is an index within their OWN
 * composition, so dispatching one as a same-composition edit - which every
 * manifest-linked operation used to do, with nestedTarget: null - would
 * silently edit whatever layer sits at that index in the scene's top
 * composition. These pin the fix: nested text/footage dispatch through the
 * verified chain, and everything that cannot, fails closed.
 */
describe("resolveExecuteFrameDispatch - nested manifest placeholders", () => {
  const nestedPlaceholder = (overrides: Record<string, unknown>) => ({
    placeholderId: "ph-nested",
    displayLabel: null,
    compositionId: "comp-grand",
    layerName: "Nested Title",
    layerIndex: 2,
    layerPath: ["Child", "Grand"],
    nestedTarget: [
      { compositionId: "comp-child", layerIndex: 4 },
      { compositionId: "comp-grand", layerIndex: 2 }
    ],
    placeholderType: "text" as const,
    originalText: "The template's own wording",
    editable: true,
    sourceType: "TextLayer",
    dimensions: null,
    startTimeSeconds: 0,
    durationSeconds: 5,
    evidence: { source: "read_directly" as const, reason: "fixture" },
    ...overrides
  });

  function nestedManifest(placeholders: ReturnType<typeof nestedPlaceholder>[], grandParents: string[] = ["comp-child"]): TemplateManifest {
    const base = validManifest();
    return validManifest({
      compositions: [
        ...base.compositions,
        { compositionId: "comp-child", aeProjectItemIndex: 7, name: "Child", widthPx: 1242, heightPx: 2648, durationSeconds: 5, frameRate: 25, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-1"] },
        { compositionId: "comp-grand", aeProjectItemIndex: 9, name: "Grand", widthPx: 1242, heightPx: 2648, durationSeconds: 5, frameRate: 25, isNestedOnlyReferenced: true, parentCompositionIds: grandParents }
      ],
      scenes: [{ ...base.scenes[0]!, placeholders: [...base.scenes[0]!.placeholders, ...placeholders] as never }]
    });
  }

  function dispatchWith(manifest: TemplateManifest, mappings: PlaceholderMapping[]) {
    return resolveExecuteFrameDispatch(
      baseInput({ currentProjectManifest: manifest, currentPlan: validPlan({ scenePlans: [validScene({ mappings })] }) })
    );
  }

  it("dispatches a nested TEXT placeholder through its verified chain - layerIndex null, every hop's aeProjectItemIndex freshly resolved", () => {
    const result = dispatchWith(nestedManifest([nestedPlaceholder({})]), [textMapping({ id: "m-nested", manifestPlaceholderId: "ph-nested", text: "Nested headline" })]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([
      {
        type: "SET_TEXT",
        manifestPlaceholderId: "ph-nested",
        layerIndex: null,
        nestedTarget: [
          { compositionId: "comp-child", aeProjectItemIndex: 7, layerIndex: 4 },
          { compositionId: "comp-grand", aeProjectItemIndex: 9, layerIndex: 2 }
        ],
        text: "Nested headline"
      }
    ]);
  });

  it("dispatches a nested IMAGE placeholder as MAP_FOOTAGE through its chain", () => {
    const image = nestedPlaceholder({
      placeholderId: "ph-nested-image",
      compositionId: "comp-child",
      layerName: "screen.png",
      layerIndex: 3,
      layerPath: ["Child"],
      nestedTarget: [{ compositionId: "comp-child", layerIndex: 3 }],
      placeholderType: "image",
      sourceType: "AVLayer",
      ...CARD_SLOT
    });
    const result = dispatchWith(nestedManifest([image]), [imageMapping({ id: "m-img", manifestPlaceholderId: "ph-nested-image" })]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations[0]).toMatchObject({
      type: "MAP_FOOTAGE",
      manifestPlaceholderId: "ph-nested-image",
      layerIndex: null,
      nestedTarget: [{ compositionId: "comp-child", aeProjectItemIndex: 7, layerIndex: 3 }],
      assetId: ASSET_ID
    });
  });

  it("leaves a top-level placeholder exactly as before when nested ones exist alongside it", () => {
    const result = dispatchWith(nestedManifest([nestedPlaceholder({})]), [textMapping()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations).toEqual([{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 2, nestedTarget: null, text: "Approved Headline" }]);
  });

  // The backstop. The manifest schema does not reject unknown keys, so an
  // older API can persist a nested placeholder with its chain STRIPPED. That
  // must fail closed - never be treated as "layer 2 of the scene".
  it("REFUSES a placeholder from another composition that carries no chain, instead of editing the scene's own layer at that index", () => {
    const stripped = nestedPlaceholder({ nestedTarget: undefined });
    const result = dispatchWith(nestedManifest([stripped]), [textMapping({ id: "m-stripped", manifestPlaceholderId: "ph-nested", text: "x" })]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not this scene's own composition/);
  });

  it("REFUSES a chain whose last step is not the placeholder's own layer - an inconsistent manifest entry", () => {
    const inconsistent = nestedPlaceholder({
      nestedTarget: [
        { compositionId: "comp-child", layerIndex: 4 },
        { compositionId: "comp-grand", layerIndex: 99 }
      ]
    });
    const result = dispatchWith(nestedManifest([inconsistent]), [textMapping({ id: "m-bad", manifestPlaceholderId: "ph-nested", text: "x" })]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/internally inconsistent/);
  });

  it("REFUSES a chain that no longer matches the CURRENT manifest's composition graph", () => {
    const result = dispatchWith(nestedManifest([nestedPlaceholder({})], []), [textMapping({ id: "m-stale", manifestPlaceholderId: "ph-nested", text: "x" })]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no longer valid/);
  });

  it("REFUSES SET_BRAND_COLOR on a nested color placeholder rather than recoloring the scene's own layer", () => {
    const color = nestedPlaceholder({ placeholderType: "color", sourceType: "AVLayer" });
    const result = dispatchWith(nestedManifest([color]), [
      textMapping({
        id: "m-color",
        manifestPlaceholderId: "ph-nested",
        text: null,
        colorHex: "#112233",
        placeholderClassification: { value: "color", source: "MANIFEST", evidence: [] }
      })
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/SET_BRAND_COLOR can only target/);
  });

  it("REFUSES a visibility/freeze/duration override on a nested placeholder - those operations have no nested form", () => {
    const result = dispatchWith(nestedManifest([nestedPlaceholder({})]), [
      textMapping({ id: "m-vis", manifestPlaceholderId: "ph-nested", text: "x", layerVisible: false })
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/SET_LAYER_VISIBILITY \/ SET_TIME_REMAP_FREEZE \/ SET_DURATION/);
  });
});

/**
 * Cross-scene shared layers (code review findings, 2026-09-13). A precomp used
 * by two scenes is ONE layer in the working copy; inspection lists it under
 * both scenes, so dispatch must refuse two INCLUDED scenes writing different
 * values to it - otherwise the later scene silently overwrites the earlier
 * one's approved content.
 */
describe("resolveExecuteFrameDispatch - conflicting writes to a layer shared across scenes", () => {
  const sharedPlaceholder = (placeholderId: string) => ({
    placeholderId,
    displayLabel: null,
    compositionId: "comp-shared",
    layerName: "Logo Text",
    layerIndex: 1,
    layerPath: ["Shared"],
    nestedTarget: [{ compositionId: "comp-shared", layerIndex: 1 }],
    placeholderType: "text" as const,
    originalText: "The template's own wording",
    editable: true,
    sourceType: "TextLayer",
    dimensions: null,
    startTimeSeconds: 0,
    durationSeconds: 5,
    evidence: { source: "read_directly" as const, reason: "fixture" }
  });

  function twoSceneManifest(): TemplateManifest {
    const base = validManifest();
    return validManifest({
      compositions: [
        ...base.compositions,
        { compositionId: "comp-2", aeProjectItemIndex: 6, name: "Scene 02", widthPx: 1080, heightPx: 1920, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
        { compositionId: "comp-shared", aeProjectItemIndex: 7, name: "Shared", widthPx: 500, heightPx: 500, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-1", "comp-2"] }
      ],
      scenes: [
        { ...base.scenes[0]!, placeholders: [...base.scenes[0]!.placeholders, sharedPlaceholder("ph-shared-s1")] as never },
        { sceneId: "scene-b", displayName: null, compositionId: "comp-2", originalOrderIndex: 1, startTimeSeconds: 0, durationSeconds: 5, placeholders: [sharedPlaceholder("ph-shared-s2")] as never }
      ]
    });
  }

  function dispatchSceneOneWith(otherText: string | null, otherUse = true) {
    const sceneOne = validScene({ mappings: [textMapping({ id: "m-s1", manifestPlaceholderId: "ph-shared-s1", text: "Brand A" })] });
    const sceneTwo = validScene({
      id: "scene-2",
      manifestCompositionId: "comp-2",
      compositionName: "Scene 02",
      sourcePosition: 1,
      finalOrder: 1,
      use: otherUse,
      mappings: [textMapping({ id: "m-s2", manifestPlaceholderId: "ph-shared-s2", text: otherText })]
    });
    return resolveExecuteFrameDispatch(
      baseInput({ currentProjectManifest: twoSceneManifest(), currentPlan: validPlan({ scenePlans: [sceneOne, sceneTwo] }) })
    );
  }

  it("REFUSES when another included scene writes DIFFERENT text to the same shared layer", () => {
    const result = dispatchSceneOneWith("Brand B");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('"Scene 01"');
    expect(result.reason).toContain('"Scene 02"');
    expect(result.reason).toMatch(/composition "comp-shared" layer 1/);
    expect(result.reason).toMatch(/silently overwrite/);
  });

  it("allows the SAME text in both scenes - the edit genuinely applies wherever the precomp appears", () => {
    const result = dispatchSceneOneWith("Brand A");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.operations[0]).toMatchObject({ type: "SET_TEXT", layerIndex: null, text: "Brand A" });
  });

  it("allows it when the other scene leaves that layer unset", () => {
    expect(dispatchSceneOneWith(null).ok).toBe(true);
  });

  it("allows it when the other scene is EXCLUDED from the output (use=false)", () => {
    expect(dispatchSceneOneWith("Brand B", false).ok).toBe(true);
  });
});

describe("resolveExecuteFrameDispatch - conflicting writes to one layer WITHIN a scene", () => {
  const nestedTextPlaceholder = {
    placeholderId: "ph-nested",
    displayLabel: null,
    compositionId: "comp-grand",
    layerName: "Nested Title",
    layerIndex: 2,
    layerPath: ["Child", "Grand"],
    nestedTarget: [
      { compositionId: "comp-child", layerIndex: 4 },
      { compositionId: "comp-grand", layerIndex: 2 }
    ],
    placeholderType: "text" as const,
    originalText: "The template's own wording",
    editable: true,
    sourceType: "TextLayer",
    dimensions: null,
    startTimeSeconds: 0,
    durationSeconds: 5,
    evidence: { source: "read_directly" as const, reason: "fixture" }
  };

  function manifest(): TemplateManifest {
    const base = validManifest();
    return validManifest({
      compositions: [
        ...base.compositions,
        { compositionId: "comp-child", aeProjectItemIndex: 7, name: "Child", widthPx: 1242, heightPx: 2648, durationSeconds: 5, frameRate: 25, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-1"] },
        { compositionId: "comp-grand", aeProjectItemIndex: 9, name: "Grand", widthPx: 1242, heightPx: 2648, durationSeconds: 5, frameRate: 25, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-child"] }
      ],
      scenes: [{ ...base.scenes[0]!, placeholders: [...base.scenes[0]!.placeholders, nestedTextPlaceholder] as never }]
    });
  }

  const humanSameLayer = (text: string) =>
    textMapping({
      id: "m-human",
      manifestPlaceholderId: null,
      mappingSource: "HUMAN",
      humanNestedTarget: [
        { compositionId: "comp-child", layerIndex: 4 },
        { compositionId: "comp-grand", layerIndex: 2 }
      ],
      text
    });

  const dispatch = (mappings: PlaceholderMapping[]) =>
    resolveExecuteFrameDispatch(baseInput({ currentProjectManifest: manifest(), currentPlan: validPlan({ scenePlans: [validScene({ mappings })] }) }));

  it("REFUSES a manifest nested mapping and a human-added mapping that write DIFFERENT text to the same layer", () => {
    const result = dispatch([textMapping({ id: "m-manifest", manifestPlaceholderId: "ph-nested", text: "From manifest" }), humanSameLayer("From human")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/two mappings that set different content on the same After Effects layer/);
    expect(result.reason).toMatch(/composition "comp-grand" layer 2/);
  });

  it("allows two mappings writing the SAME text to that layer - identical, not conflicting", () => {
    const result = dispatch([textMapping({ id: "m-manifest", manifestPlaceholderId: "ph-nested", text: "Same" }), humanSameLayer("Same")]);
    expect(result.ok).toBe(true);
  });
});
