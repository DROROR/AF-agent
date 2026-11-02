import { describe, expect, it } from "vitest";
import { buildOperationScript } from "./jsx-templates.js";

/**
 * REAL 2026-11-02: an empty holder composition (the template's "put your
 * screen in here") is a card. The script must recognise it from After
 * Effects' own facts (a CompItem source none of whose layers is enabled),
 * fit the media to the holder's own size, keep the layer under its matte
 * (the screen's rounded shape), and switch off a matte that only draws a
 * Checkerboard placeholder pattern. Text of the fixed script is the only
 * thing checkable here; the behaviour was verified on the real template.
 */
describe("MAP_FOOTAGE script - an empty holder composition is a screen card", () => {
  const script = buildOperationScript(12, "Scene 06", {
    type: "MAP_FOOTAGE",
    manifestPlaceholderId: "ph-1",
    layerIndex: null,
    nestedTarget: [{ compositionId: "comp-1428", aeProjectItemIndex: 1428, layerIndex: 2 }],
    assetPath: "C:\\DYO-Agent\\assets\\screen.jpg"
  });
  const text = String(script);

  it("recognises a holder from its switched-off layers, never from a name", () => {
    expect(text).toContain("__layer.source instanceof CompItem");
    expect(text).toContain("__holderDrawsNothing");
    expect(text).toContain("__holderCard = true");
  });

  it("keeps a matted holder under its matte and switches off a Checkerboard placeholder matte", () => {
    expect(text).toContain("__holderKeepsMatte");
    expect(text).toContain('"ADBE Checkerboard"');
    expect(text).toContain("__matteLayer.enabled = false");
    expect(text).toContain("could not be switched off - it would paint over the picture");
  });
});
