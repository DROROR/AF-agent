import type { Placeholder, PlaceholderMapping, Scene, ScenePlanEntry, TemplateManifest } from "@dyo/schemas";

/**
 * SYNTHETIC template/plan fixtures for the leftover-template-copy gate.
 *
 * Deliberately generic: no real template's names, layer indices, dimensions,
 * hierarchy or wording appear here. Tests build whatever shape they need -
 * several scenes sharing wording, a legacy manifest with no captured text, a
 * truncated capture, multiline and non-Latin text - so the gate is proven
 * against many template shapes rather than the one project that motivated it.
 */

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

export interface TextPlaceholderSpec {
  placeholderId: string;
  layerName?: string;
  /** Absent key = this manifest never captured template text (legacy manifest). */
  originalText?: string | null;
  originalTextTruncated?: boolean;
  /** Display-only excerpt of a text too long to store in full. */
  originalTextPreview?: string;
  /** Digests of the COMPLETE text - what keeps a too-long text verifiable. */
  originalTextVerification?: Placeholder["originalTextVerification"];
  /** COMPLETE / VERIFIED_EXCERPT / CAPTURE_FAILED / TOO_LARGE - absent models a manifest predating capture. */
  originalTextCaptureStatus?: Placeholder["originalTextCaptureStatus"];
  originalTextCodeUnitLength?: number;
  placeholderType?: Placeholder["placeholderType"];
}

export function placeholderFixture(spec: TextPlaceholderSpec): Placeholder {
  const {
    placeholderId,
    layerName = "a layer",
    originalText,
    originalTextTruncated,
    originalTextPreview,
    originalTextVerification,
    originalTextCaptureStatus,
    originalTextCodeUnitLength,
    placeholderType = "text"
  } = spec;
  return {
    placeholderId,
    displayLabel: null,
    compositionId: "composition-under-test",
    layerName,
    layerIndex: 1,
    layerPath: [],
    nestedTarget: null,
    placeholderType,
    editable: true,
    sourceType: placeholderType === "text" ? "TextLayer" : "AVLayer",
    ...(originalText === undefined ? {} : { originalText }),
    ...(originalTextTruncated === undefined ? {} : { originalTextTruncated }),
    ...(originalTextPreview === undefined ? {} : { originalTextPreview }),
    ...(originalTextVerification === undefined ? {} : { originalTextVerification }),
    ...(originalTextCaptureStatus === undefined ? {} : { originalTextCaptureStatus }),
    ...(originalTextCodeUnitLength === undefined ? {} : { originalTextCodeUnitLength }),
    dimensions: null,
    startTimeSeconds: 0,
    durationSeconds: 5,
    evidence: { source: "read_directly", reason: "AE layer type is TextLayer" }
  };
}

export function manifestFixture(placeholderSpecs: readonly TextPlaceholderSpec[], sceneOverrides: Partial<Scene> = {}): TemplateManifest {
  return {
    schemaVersion: "1.0",
    templateId: "template-under-test",
    templateName: "Template Under Test",
    sourceProject: { path: "/templates/under-test.aep", name: "under-test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "2026" },
    generatedAt: TIMESTAMP,
    compositions: [],
    scenes: [
      {
        sceneId: "scene-under-test",
        displayName: null,
        compositionId: "composition-under-test",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: placeholderSpecs.map(placeholderFixture),
        ...sceneOverrides
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

export function mappingFixture(overrides: Partial<PlaceholderMapping> & { id: string }): PlaceholderMapping {
  return {
    manifestPlaceholderId: overrides.id,
    placeholderName: "a layer",
    placeholderClassification: { value: "text", source: "MANIFEST", evidence: [] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    keepTemplateText: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    humanLayerIndex: null,
    humanNestedTarget: null,
    confidence: null,
    mappingSource: "MANIFEST",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides
  };
}

export function scenePlanFixture(overrides: Partial<ScenePlanEntry> & { id: string }): ScenePlanEntry {
  return {
    manifestCompositionId: "composition-under-test",
    compositionName: "Scene Under Test",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "APPROVED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [],
    reelsLayout: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides
  };
}
