import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type PlaceholderMapping, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
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
