import { describe, expect, it } from "vitest";
import {
  parseAeVersionFromHealth,
  parseCaptureFrame,
  parseCompositionDetail,
  parseCompositionList,
  parseLayerDetail,
  parseProjectInfo
} from "./parse-mcp-shapes.js";

/**
 * Fixtures below are SANITIZED - they match the real, confirmed shapes of
 * ae_health/ae_list_instances/ae_get_project_info/ae_list_compositions
 * (confirmed 2026-08-26 from a real successful INSPECT_TEMPLATE job) and
 * ae_get_composition (confirmed from the real upstream
 * HeroicSwan/after-effects-mcp `host-scripts/ae-mcp-methods.jsx` source),
 * but every value is synthetic - no real client project names, paths, or
 * structure are committed here.
 */
function textContent(value: unknown) {
  return [{ type: "text", text: JSON.stringify(value) }];
}

describe("parseProjectInfo", () => {
  it("parses the real confirmed ae_get_project_info shape", () => {
    const result = parseProjectInfo(
      textContent({
        name: "Untitled",
        path: null,
        bitsPerChannel: 8,
        numItems: 12,
        compositions: [
          { index: 3, name: "Comp A", width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 2 },
          { index: 7, name: "Comp B", width: 1080, height: 1920, frameRate: 30, duration: 10, numLayers: 0 }
        ]
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.aeReportedName).toBe("Untitled");
      expect(result.value.aeReportedPath).toBeNull();
      expect(result.value.compositions).toHaveLength(2);
      expect(result.value.compositions[0]).toEqual({
        index: 3,
        name: "Comp A",
        widthPx: 1920,
        heightPx: 1080,
        frameRate: 30,
        durationSeconds: 5,
        numLayers: 2
      });
    }
  });

  it("fails honestly when a composition entry does not match the confirmed shape, never guessing partial fields", () => {
    const result = parseProjectInfo(textContent({ name: "x", path: null, numItems: 1, compositions: [{ onlyName: "oops" }] }));
    expect(result.ok).toBe(false);
  });

  it("fails when content is not the expected MCP text-block array", () => {
    expect(parseProjectInfo("not an array" as unknown).ok).toBe(false);
    expect(parseProjectInfo([{ type: "image" }] as unknown).ok).toBe(false);
  });

  it("fails when the text block is not valid JSON", () => {
    expect(parseProjectInfo([{ type: "text", text: "not json at all" }]).ok).toBe(false);
  });
});

describe("parseCompositionList", () => {
  it("parses the real confirmed ae_list_compositions shape - a bare array", () => {
    const result = parseCompositionList(
      textContent([{ index: 3, name: "Comp A", width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 2 }])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.index).toBe(3);
    }
  });

  it("fails when the response is an object instead of a bare array", () => {
    expect(parseCompositionList(textContent({ compositions: [] })).ok).toBe(false);
  });
});

describe("parseAeVersionFromHealth", () => {
  it("parses the real confirmed ae_health shape, extracting only health.aeVersion", () => {
    const result = parseAeVersionFromHealth(
      textContent({
        connected: true,
        ae_running: true,
        instances: [{ instanceId: "default", aeVersion: "26.3x87" }],
        health: { connected: true, aeVersion: "26.3x87", projectOpen: true }
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("26.3x87");
    }
  });

  it("returns null (not a failure) when health.aeVersion is genuinely absent - null stays null, never fabricated", () => {
    const result = parseAeVersionFromHealth(textContent({ connected: false }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });
});

describe("parseCompositionDetail", () => {
  it("parses the real confirmed ae_get_composition (detailed) shape, including nested layers", () => {
    const result = parseCompositionDetail(
      textContent({
        name: "Comp A",
        id: 42,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 5,
        numLayers: 2,
        bgColor: [0, 0, 0],
        layers: [
          { index: 1, name: "Text Layer", enabled: true, inPoint: 0, outPoint: 5, startTime: 0, nullLayer: false, threeDLayer: false, parent: null },
          { index: 2, name: "Null Anchor", enabled: true, inPoint: 0, outPoint: 5, startTime: 0, nullLayer: true, threeDLayer: false, parent: null }
        ]
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.compId).toBe(42);
      expect(result.value.layers).toHaveLength(2);
      expect(result.value.layers?.[1]?.nullLayer).toBe(true);
    }
  });

  it("parses the concise (non-detailed) shape - layers is null, never an empty-array fabrication", () => {
    const result = parseCompositionDetail(
      textContent({ name: "Comp A", id: 42, width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 2, bgColor: [0, 0, 0] })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.layers).toBeNull();
    }
  });

  it("fails honestly when a layers[] entry does not match the confirmed layerSummary shape", () => {
    const result = parseCompositionDetail(
      textContent({ name: "Comp A", width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 1, layers: [{ unexpected: true }] })
    );
    expect(result.ok).toBe(false);
  });
});

describe("parseLayerDetail", () => {
  it("parses the real confirmed ae_get_layer (detailed) shape - layerSummary(layer, true)", () => {
    const result = parseLayerDetail(
      textContent({
        index: 1,
        name: "APP PROMO",
        enabled: true,
        inPoint: 0,
        outPoint: 4,
        startTime: 0,
        nullLayer: false,
        threeDLayer: false,
        parent: null,
        position: [960, 540],
        scale: [100, 100],
        rotation: 0,
        opacity: 100,
        effects: []
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        index: 1,
        name: "APP PROMO",
        enabled: true,
        inPointSeconds: 0,
        outPointSeconds: 4,
        startTimeSeconds: 0,
        nullLayer: false,
        threeDLayer: false,
        parentLayerName: null,
        opacityPercent: 100
      });
    }
  });

  it("reads the parent field as the parent layer's NAME, never an index - upstream reads layer.parent.name", () => {
    const result = parseLayerDetail(
      textContent({
        index: 2,
        name: "Child Layer",
        enabled: true,
        inPoint: 0,
        outPoint: 4,
        startTime: 0,
        nullLayer: false,
        threeDLayer: false,
        parent: "Null Anchor"
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parentLayerName).toBe("Null Anchor");
    }
  });

  it("never exposes a layer-type field - ae_get_layer's confirmed shape has none to parse", () => {
    const result = parseLayerDetail(
      textContent({
        index: 1,
        name: "Text Layer",
        enabled: true,
        inPoint: 0,
        outPoint: 4,
        startTime: 0,
        nullLayer: false,
        threeDLayer: false,
        parent: null
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("layerType");
      expect(result.value).not.toHaveProperty("sourceText");
    }
  });

  it("fails honestly on a response missing required fields", () => {
    const result = parseLayerDetail(textContent({ index: 1, name: "X" }));
    expect(result.ok).toBe(false);
  });
});

describe("parseCaptureFrame", () => {
  it("parses the common (image-embedded) real tool-level response shape - path/comp/time only, width/height/bytes not present", () => {
    const content = [
      { type: "text", text: JSON.stringify({ path: "/home/worker/.ae-mcp/previews/Text_01_123.png", comp: "Text 01", time: 2, note: "Frame captured. Image attached below.", previews_dir: "/home/worker/.ae-mcp/previews" }) },
      { type: "image", data: "base64==", mimeType: "image/png" }
    ];
    const result = parseCaptureFrame(content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ path: "/home/worker/.ae-mcp/previews/Text_01_123.png", compName: "Text 01", timeSeconds: 2 });
    }
  });

  it("parses the fallback (file-not-ready-in-time) real host-level response shape - no image block", () => {
    const content = textContent({ path: "/home/worker/.ae-mcp/previews/Text_01_123.png", comp: "Text 01", time: 2, width: 1920, height: 1080, bytes: 45210 });
    const result = parseCaptureFrame(content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ path: "/home/worker/.ae-mcp/previews/Text_01_123.png", compName: "Text 01", timeSeconds: 2 });
    }
  });

  it("fails honestly when neither confirmed shape matches", () => {
    const result = parseCaptureFrame(textContent({ unexpected: true }));
    expect(result.ok).toBe(false);
  });
});
