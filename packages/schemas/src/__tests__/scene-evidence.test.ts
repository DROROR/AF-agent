import { describe, expect, it } from "vitest";
import {
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
    compositionIndex: 14,
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
    compositionIndex: 14,
    compositionName: "Text 01",
    layers: [validLayer()],
    preview: null,
    previewFailureReason: null,
    capturedAt: "2026-08-26T00:00:00.000Z",
    ...overrides
  };
}

describe("sceneEvidenceRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(() => sceneEvidenceRequestSchema.parse(validRequest())).not.toThrow();
  });

  it("rejects a request with zero layerIndices", () => {
    expect(() => sceneEvidenceRequestSchema.parse(validRequest({ layerIndices: [] }))).toThrow();
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
