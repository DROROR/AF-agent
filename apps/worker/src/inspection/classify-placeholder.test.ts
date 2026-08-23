import { describe, expect, it } from "vitest";
import { classifyPlaceholder } from "./classify-placeholder.js";
import type { LayerFact } from "./project-facts.js";

function baseLayer(overrides: Partial<LayerFact> = {}): LayerFact {
  return {
    name: "Layer",
    index: 1,
    layerKind: "Unknown",
    footage: null,
    solidFill: null,
    layerPath: [],
    startTimeSeconds: 0,
    durationSeconds: 5,
    ...overrides
  };
}

describe("classifyPlaceholder", () => {
  it("classifies a TextLayer as text, editable, with direct evidence", () => {
    const result = classifyPlaceholder(baseLayer({ layerKind: "TextLayer" }));
    expect(result.placeholderType).toBe("text");
    expect(result.editable).toBe(true);
    expect(result.evidence.source).toBe("read_directly");
  });

  it("classifies an AVLayer with video footage as video", () => {
    const result = classifyPlaceholder(
      baseLayer({
        layerKind: "AVLayer",
        footage: { hasVideo: true, hasAudio: true, isStill: false, isMissing: false, widthPx: 1920, heightPx: 1080 }
      })
    );
    expect(result.placeholderType).toBe("video");
    expect(result.editable).toBe(true);
  });

  it("classifies an AVLayer with a still-image footage source as image", () => {
    const result = classifyPlaceholder(
      baseLayer({
        layerKind: "AVLayer",
        footage: { hasVideo: false, hasAudio: false, isStill: true, isMissing: false, widthPx: 512, heightPx: 512 }
      })
    );
    expect(result.placeholderType).toBe("image");
    expect(result.editable).toBe(true);
  });

  it("classifies a uniform solid fill as color", () => {
    const result = classifyPlaceholder(baseLayer({ layerKind: "ShapeLayer", solidFill: { isUniformSolidFill: true } }));
    expect(result.placeholderType).toBe("color");
  });

  it("classifies missing footage as unknown, not a guessed type, and marks it not editable", () => {
    const result = classifyPlaceholder(
      baseLayer({
        layerKind: "AVLayer",
        footage: { hasVideo: false, hasAudio: false, isStill: false, isMissing: true, widthPx: null, heightPx: null }
      })
    );
    expect(result.placeholderType).toBe("unknown");
    expect(result.editable).toBe(false);
    expect(result.evidence.source).toBe("unknown");
  });

  it("classifies a structurally ambiguous layer as unknown rather than guessing", () => {
    const result = classifyPlaceholder(baseLayer({ layerKind: "CameraLayer" }));
    expect(result.placeholderType).toBe("unknown");
    expect(result.evidence.source).toBe("unknown");
  });

  it("never classifies anything as logo or phone_screen - no structural signal implies either", () => {
    const facts: LayerFact[] = [
      baseLayer({ layerKind: "TextLayer" }),
      baseLayer({
        layerKind: "AVLayer",
        footage: { hasVideo: true, hasAudio: false, isStill: false, isMissing: false, widthPx: 100, heightPx: 100 }
      }),
      baseLayer({
        layerKind: "AVLayer",
        footage: { hasVideo: false, hasAudio: false, isStill: true, isMissing: false, widthPx: 100, heightPx: 100 }
      }),
      baseLayer({ layerKind: "ShapeLayer", solidFill: { isUniformSolidFill: true } }),
      baseLayer({ layerKind: "Unknown" })
    ];
    for (const fact of facts) {
      const result = classifyPlaceholder(fact);
      expect(result.placeholderType).not.toBe("logo");
      expect(result.placeholderType).not.toBe("phone_screen");
    }
  });
});
