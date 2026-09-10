import { describe, expect, it } from "vitest";
import {
  hostLayerRecordSchema,
  layerDetailFactSchema,
  layerEvidenceSchema,
  sceneEvidenceRequestSchema,
  sceneEvidenceResponseSchema,
  type LayerEvidence,
  type SceneEvidenceResponse
} from "../scene-evidence.js";

const SHA = "a".repeat(64);

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep",
    sourceProjectSha256: SHA,
    manifestCompositionId: "comp-275",
    aeProjectItemIndex: 14,
    compositionName: "Text 01",
    layerIndices: [1],
    ...overrides
  };
}

function validLayer(overrides: Partial<LayerEvidence> = {}): LayerEvidence {
  return {
    layerIndex: 1,
    name: "APP PROMO",
    enabled: true,
    nullLayer: false,
    threeDLayer: false,
    inPointSeconds: 0,
    outPointSeconds: 4,
    startTimeSeconds: 0,
    parentLayerName: null,
    opacityPercent: 100,
    layerType: null,
    sourceItemName: null,
    sourceWidthPx: null,
    sourceHeightPx: null,
    sourceDurationSeconds: null,
    textValue: null,
    nestedCompositionId: null,
    evidenceSource: "AE_GET_LAYER",
    ...overrides
  };
}

function validResponse(overrides: Partial<SceneEvidenceResponse> = {}): SceneEvidenceResponse {
  return {
    verifiedSourceProjectSha256: SHA,
    manifestCompositionId: "comp-275",
    aeProjectItemIndex: 14,
    compositionName: "Text 01",
    layers: [validLayer()],
    preview: null,
    previewFailureReason: null,
    layerDetails: null,
    layerDetailsFailureReason: null,
    hostLayerRecords: null,
    hostLayerRecordsFailureReason: null,
    compositionSummary: null,
    compositionSummaryFailureReason: null,
    capturedAt: "2026-08-26T00:00:00.000Z",
    ...overrides
  };
}

describe("sceneEvidenceRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(() => sceneEvidenceRequestSchema.parse(validRequest())).not.toThrow();
  });

  it("accepts a request with zero layerIndices - a composition with no editable placeholders can still get a real frame capture (live QA Blocker 2 fix)", () => {
    const parsed = sceneEvidenceRequestSchema.parse(validRequest({ layerIndices: [] }));
    expect(parsed.layerIndices).toEqual([]);
  });

  it("rejects a request with more than 20 layerIndices - bounded result", () => {
    const many = Array.from({ length: 21 }, (_, i) => i + 1);
    expect(() => sceneEvidenceRequestSchema.parse(validRequest({ layerIndices: many }))).toThrow();
  });

  it("rejects a non-64-char sourceProjectSha256", () => {
    expect(() => sceneEvidenceRequestSchema.parse(validRequest({ sourceProjectSha256: "short" }))).toThrow();
  });

  it("rejects an extra/unexpected top-level field", () => {
    expect(() => sceneEvidenceRequestSchema.parse({ ...validRequest(), aeRunJsx: "app.project.save()" })).toThrow();
  });

  it("defaults previewTimestampSeconds to null when omitted", () => {
    const parsed = sceneEvidenceRequestSchema.parse(validRequest());
    expect(parsed.previewTimestampSeconds).toBeNull();
  });
});

describe("layerEvidenceSchema", () => {
  it("accepts a fully-null-unknowns layer - unknown stays unknown, never guessed", () => {
    expect(() => layerEvidenceSchema.parse(validLayer())).not.toThrow();
  });

  it("rejects a layerType value other than null - layer type is never inferred by this contract", () => {
    expect(() => layerEvidenceSchema.parse({ ...validLayer(), layerType: "text" })).toThrow();
  });

  it("rejects an unrecognized evidenceSource", () => {
    expect(() => layerEvidenceSchema.parse({ ...validLayer(), evidenceSource: "AE_RUN_JSX" })).toThrow();
  });
});

describe("sceneEvidenceResponseSchema", () => {
  it("accepts a valid response with no preview", () => {
    expect(() => sceneEvidenceResponseSchema.parse(validResponse())).not.toThrow();
  });

  it("accepts a valid response with a verified preview", () => {
    const withPreview = validResponse({
      preview: { timestampSeconds: 2, path: "/home/worker/.ae-mcp/previews/Text_01_123.png", bytes: 45210 }
    });
    expect(() => sceneEvidenceResponseSchema.parse(withPreview)).not.toThrow();
  });

  it("rejects a preview with zero bytes - an empty file is never an acceptable preview", () => {
    const withEmptyPreview = validResponse({
      preview: { timestampSeconds: 2, path: "/home/worker/.ae-mcp/previews/empty.png", bytes: 0 }
    });
    expect(() => sceneEvidenceResponseSchema.parse(withEmptyPreview)).toThrow();
  });
});

/**
 * Preview Timing Analysis real incident regression (live QA, 2026-09-09,
 * job 5ca6261d-dc82-4a4e-a6b0-ee2435817ded): the operator's "Analyze
 * Preview Timing" click failed with "The Worker's inspection result was
 * not in the expected format." The job's own persisted result (exact raw
 * shape below, taken verbatim from the database) proves why - it was
 * answered by a Worker still running the pre-9b8dae6
 * buildInspectCompositionLayerDetailsScript, which never emits
 * `stretchPercent`/`timeRemapEnabled` at all (not merely null - the KEYS
 * are entirely absent). A rolling deploy can never guarantee the API and
 * every Worker update at the exact same instant, so this is a real,
 * recurring version-skew shape, not a one-off data error. Fixed by
 * widening layerDetailFactSchema's two new fields to `.optional()`
 * (normalized to `null` either way by the schema's own transform), so an
 * older Worker's response still parses - rather than adding a
 * UI/consumer-side special case for "these two keys might be missing".
 */
describe("layerDetailFactSchema - real 2026-09-09 Worker/API version-skew incident (job 5ca6261d)", () => {
  const REAL_INCIDENT_LAYER_DETAILS_ENTRY = {
    layerName: "Control Color",
    layerType: "AV",
    layerIndex: 1,
    sourceText: null,
    sourceCompositionId: null
    // stretchPercent/timeRemapEnabled genuinely absent - the exact real
    // shape an out-of-date Worker sent, verbatim from the database.
  };

  it("parses the exact real incident entry (stretchPercent/timeRemapEnabled keys entirely absent, not merely null), normalizing both to null", () => {
    const parsed = layerDetailFactSchema.parse(REAL_INCIDENT_LAYER_DETAILS_ENTRY);
    expect(parsed.stretchPercent).toBeNull();
    expect(parsed.timeRemapEnabled).toBeNull();
    expect(parsed.layerName).toBe("Control Color");
  });

  it("treats an absent key and an explicit null identically - both normalize to the exact same parsed shape", () => {
    const withExplicitNulls = layerDetailFactSchema.parse({ ...REAL_INCIDENT_LAYER_DETAILS_ENTRY, stretchPercent: null, timeRemapEnabled: null });
    const withAbsentKeys = layerDetailFactSchema.parse(REAL_INCIDENT_LAYER_DETAILS_ENTRY);
    expect(withAbsentKeys).toEqual(withExplicitNulls);
  });

  it("still requires every OTHER field on layerDetailFactSchema - this widening is scoped to exactly the two new fields, never a blanket relaxation", () => {
    const missingLayerType = { ...REAL_INCIDENT_LAYER_DETAILS_ENTRY } as Record<string, unknown>;
    delete missingLayerType.layerType;
    expect(() => layerDetailFactSchema.parse(missingLayerType)).toThrow();
  });

  it("still rejects a real, non-null stretchPercent/timeRemapEnabled with the wrong type - this is a version-skew tolerance, never a type-safety relaxation", () => {
    expect(() => layerDetailFactSchema.parse({ ...REAL_INCIDENT_LAYER_DETAILS_ENTRY, stretchPercent: "100" })).toThrow();
    expect(() => layerDetailFactSchema.parse({ ...REAL_INCIDENT_LAYER_DETAILS_ENTRY, timeRemapEnabled: "false" })).toThrow();
  });

  it("parses the exact real full SceneEvidenceResponse from job 5ca6261d-dc82-4a4e-a6b0-ee2435817ded (comp-1/Scene 1, layerIndices:[3]) end to end - the actual production incident, not a synthetic approximation", () => {
    const realJobResult = {
      verifiedSourceProjectSha256: "67e1b7082171ca434263821e87e2e219008ad7213921122ac5f735ef41437230",
      manifestCompositionId: "comp-1",
      aeProjectItemIndex: 48,
      compositionName: "Scene 1",
      layers: [
        {
          name: "Pre-comp 3",
          enabled: true,
          layerType: null,
          nullLayer: false,
          textValue: null,
          layerIndex: 3,
          threeDLayer: false,
          sourceWidthPx: null,
          evidenceSource: "AE_GET_LAYER",
          inPointSeconds: 1.63496830163497,
          opacityPercent: 100,
          sourceHeightPx: null,
          sourceItemName: null,
          outPointSeconds: 8.64197530864197,
          parentLayerName: null,
          startTimeSeconds: 1.63496830163497,
          nestedCompositionId: null,
          sourceDurationSeconds: null
        }
      ],
      preview: null,
      capturedAt: "2026-09-09T14:56:56.257Z",
      layerDetails: [
        { layerName: "Control Color", layerType: "AV", layerIndex: 1, sourceText: null, sourceCompositionId: null },
        { layerName: "Pre-comp 2", layerType: "PRECOMP", layerIndex: 2, sourceText: null, sourceCompositionId: "comp-1600" },
        { layerName: "Pre-comp 3", layerType: "PRECOMP", layerIndex: 3, sourceText: null, sourceCompositionId: "comp-1635" }
      ],
      previewFailureReason: null,
      layerDetailsFailureReason: null
    };

    const parsed = sceneEvidenceResponseSchema.safeParse(realJobResult);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.layerDetails).toEqual([
      { layerName: "Control Color", layerType: "AV", layerIndex: 1, sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
      { layerName: "Pre-comp 2", layerType: "PRECOMP", layerIndex: 2, sourceText: null, sourceCompositionId: "comp-1600", stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
      { layerName: "Pre-comp 3", layerType: "PRECOMP", layerIndex: 3, sourceText: null, sourceCompositionId: "comp-1635", stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null }
    ]);
  });
});

/**
 * Preview Timing Analysis targeted host-layer lookup (live QA, 2026-09-10
 * real incident, session a7fee3d9) - the SECOND real incident: even the
 * "discovery" mode + early-exit target hint still timed out scanning
 * !Render. hostLayerRecordSchema/hostLayerRecords replace that mechanism
 * with a genuinely different, dedicated operation
 * (buildFindHostLayersScript).
 */
describe("hostLayerRecordSchema", () => {
  function record(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      layerIndex: 2,
      layerName: "Pre-comp 3",
      enabled: true,
      inPointSeconds: 1.63496830163497,
      outPointSeconds: 8.64197530864197,
      startTimeSeconds: 1.63496830163497,
      sourceCompositionId: "comp-1635",
      stretchPercent: 100,
      timeRemapEnabled: false,
      opacityStatic: 100,
      opacityKeyframes: null,
      ...overrides
    };
  }

  it("accepts a real, fully-populated host layer record", () => {
    expect(() => hostLayerRecordSchema.parse(record())).not.toThrow();
  });

  it("Worker/API version-skew tolerance (same real incident class as layerDetailFactSchema above): accepts stretchPercent/timeRemapEnabled/opacityStatic/opacityKeyframes being entirely ABSENT, normalizing to null", () => {
    const raw = record();
    delete (raw as Record<string, unknown>).stretchPercent;
    delete (raw as Record<string, unknown>).timeRemapEnabled;
    delete (raw as Record<string, unknown>).opacityStatic;
    delete (raw as Record<string, unknown>).opacityKeyframes;
    const parsed = hostLayerRecordSchema.parse(raw);
    expect(parsed.stretchPercent).toBeNull();
    expect(parsed.timeRemapEnabled).toBeNull();
    expect(parsed.opacityStatic).toBeNull();
    expect(parsed.opacityKeyframes).toBeNull();
  });

  it("still requires sourceCompositionId, layerIndex, layerName, enabled, and the three timing fields - the version-skew tolerance is scoped to exactly the four optional-in-practice fields", () => {
    const raw = record();
    delete (raw as Record<string, unknown>).sourceCompositionId;
    expect(() => hostLayerRecordSchema.parse(raw)).toThrow();
  });
});

describe("sceneEvidenceResponseSchema - hostLayerRecords / hostLayerRecordsFailureReason", () => {
  it("accepts multiple real host layer records (real 2026-09-10 incident: multiple instances of the same child composition inside one parent)", () => {
    const response = {
      verifiedSourceProjectSha256: SHA,
      manifestCompositionId: "comp-210",
      aeProjectItemIndex: 2,
      compositionName: "!Render",
      layers: [],
      preview: null,
      previewFailureReason: null,
      layerDetails: null,
      layerDetailsFailureReason: null,
      hostLayerRecords: [
        {
          layerIndex: 9,
          layerName: "Scene 1 instance A",
          enabled: true,
          inPointSeconds: 0,
          outPointSeconds: 7.007007007007,
          startTimeSeconds: 0,
          sourceCompositionId: "comp-1",
          stretchPercent: 100,
          timeRemapEnabled: false,
          opacityStatic: 100,
          opacityKeyframes: null
        },
        {
          layerIndex: 34,
          layerName: "Scene 1 instance B",
          enabled: true,
          inPointSeconds: 20,
          outPointSeconds: 27.007007007007,
          startTimeSeconds: 20,
          sourceCompositionId: "comp-1",
          stretchPercent: 100,
          timeRemapEnabled: false,
          opacityStatic: 100,
          opacityKeyframes: null
        }
      ],
      hostLayerRecordsFailureReason: null,
      capturedAt: "2026-09-10T00:00:00.000Z"
    };
    const parsed = sceneEvidenceResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.hostLayerRecords).toHaveLength(2);
  });

  it("accepts a genuinely empty hostLayerRecords array (a successful scan that found zero real matches) - distinct from a failed scan", () => {
    const response = {
      verifiedSourceProjectSha256: SHA,
      manifestCompositionId: "comp-210",
      aeProjectItemIndex: 2,
      compositionName: "!Render",
      layers: [],
      preview: null,
      previewFailureReason: null,
      layerDetails: null,
      layerDetailsFailureReason: null,
      hostLayerRecords: [],
      hostLayerRecordsFailureReason: null,
      capturedAt: "2026-09-10T00:00:00.000Z"
    };
    const parsed = sceneEvidenceResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.hostLayerRecords).toEqual([]);
  });

  it("Worker/API version-skew tolerance: accepts hostLayerRecords/hostLayerRecordsFailureReason being entirely absent (an older Worker that predates this capability) - normalizes to null, never a hard parse failure", () => {
    const response = {
      verifiedSourceProjectSha256: SHA,
      manifestCompositionId: "comp-210",
      aeProjectItemIndex: 2,
      compositionName: "!Render",
      layers: [],
      preview: null,
      previewFailureReason: null,
      layerDetails: null,
      layerDetailsFailureReason: null,
      capturedAt: "2026-09-10T00:00:00.000Z"
    };
    const parsed = sceneEvidenceResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.hostLayerRecords).toBeNull();
    expect(parsed.data.hostLayerRecordsFailureReason).toBeNull();
  });
});

describe("compositionSummarySchema / sceneEvidenceResponseSchema - compositionSummary (real 2026-09-10 incident, session a7fee3d9)", () => {
  it("accepts a real, fully-populated composition summary", () => {
    const response = validResponse({
      compositionSummary: {
        compDurationSeconds: 45.045045045045,
        workAreaStartSeconds: 0,
        workAreaDurationSeconds: 45.045045045045,
        frameRate: 29.9700012207031,
        layers: [
          { layerIndex: 1, layerName: "Scene 1", enabled: true, inPointSeconds: 1.635, outPointSeconds: 8.642, startTimeSeconds: 1.635, sourceCompositionId: "comp-1", sourceDurationSeconds: 7.007 },
          { layerIndex: 2, layerName: "Photo", enabled: true, inPointSeconds: 0, outPointSeconds: 5, startTimeSeconds: 0, sourceCompositionId: null, sourceDurationSeconds: null }
        ]
      }
    });
    const parsed = sceneEvidenceResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.compositionSummary?.layers).toHaveLength(2);
    expect(parsed.data.compositionSummary?.compDurationSeconds).toBe(45.045045045045);
  });

  it("Worker/API version-skew tolerance: accepts compositionSummary/compositionSummaryFailureReason being entirely absent - normalizes to null, never a hard parse failure", () => {
    const response = {
      verifiedSourceProjectSha256: SHA,
      manifestCompositionId: "comp-210",
      aeProjectItemIndex: 2,
      compositionName: "!Render",
      layers: [],
      preview: null,
      previewFailureReason: null,
      layerDetails: null,
      layerDetailsFailureReason: null,
      capturedAt: "2026-09-10T00:00:00.000Z"
    };
    const parsed = sceneEvidenceResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.compositionSummary).toBeNull();
    expect(parsed.data.compositionSummaryFailureReason).toBeNull();
  });

  it("a composition summary with genuinely zero layers is distinct from a failed scan (compositionSummary: [] real layers vs compositionSummaryFailureReason set)", () => {
    const empty = validResponse({ compositionSummary: { compDurationSeconds: 5, workAreaStartSeconds: 0, workAreaDurationSeconds: 5, frameRate: 30, layers: [] } });
    const parsedEmpty = sceneEvidenceResponseSchema.safeParse(empty);
    expect(parsedEmpty.success).toBe(true);
    if (!parsedEmpty.success) return;
    expect(parsedEmpty.data.compositionSummary?.layers).toEqual([]);

    const failed = validResponse({ compositionSummary: null, compositionSummaryFailureReason: "ae_run_jsx failed: MCP error -32001: Request timed out" });
    const parsedFailed = sceneEvidenceResponseSchema.safeParse(failed);
    expect(parsedFailed.success).toBe(true);
    if (!parsedFailed.success) return;
    expect(parsedFailed.data.compositionSummary).toBeNull();
    expect(parsedFailed.data.compositionSummaryFailureReason).toContain("timed out");
  });
});
