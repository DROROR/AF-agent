import { describe, expect, it } from "vitest";
import {
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
      { layerName: "Control Color", layerType: "AV", layerIndex: 1, sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null },
      { layerName: "Pre-comp 2", layerType: "PRECOMP", layerIndex: 2, sourceText: null, sourceCompositionId: "comp-1600", stretchPercent: null, timeRemapEnabled: null },
      { layerName: "Pre-comp 3", layerType: "PRECOMP", layerIndex: 3, sourceText: null, sourceCompositionId: "comp-1635", stretchPercent: null, timeRemapEnabled: null }
    ]);
  });
});
