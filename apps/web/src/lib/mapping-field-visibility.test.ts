import { describe, expect, it } from "vitest";
import { fieldsForLayerKind } from "./mapping-field-visibility";

const nothingSet = { hasAsset: false, hasText: false, hasTimestamp: false };

/** Real complaint, 2026-10-02: a text layer offered a file picker and a timestamp, an image slot offered a text box. */
describe("fieldsForLayerKind", () => {
  it("a text layer takes text and nothing else", () => {
    expect(fieldsForLayerKind("text", nothingSet)).toEqual({ asset: false, text: true, timestamp: false });
  });

  it("a still slot - image, logo or phone screen - takes a file and nothing else", () => {
    for (const kind of ["image", "logo", "phone_screen"]) {
      expect(fieldsForLayerKind(kind, nothingSet)).toEqual({ asset: true, text: false, timestamp: false });
    }
  });

  it("a video slot takes a file and the moment in it to use", () => {
    expect(fieldsForLayerKind("video", nothingSet)).toEqual({ asset: true, text: false, timestamp: true });
  });

  it("a colour takes neither a file nor text - its own picker is separate", () => {
    expect(fieldsForLayerKind("color", nothingSet)).toEqual({ asset: false, text: false, timestamp: false });
  });

  it("a kind this screen does not know is offered everything, never nothing", () => {
    expect(fieldsForLayerKind("unknown", nothingSet)).toEqual({ asset: true, text: true, timestamp: true });
    expect(fieldsForLayerKind(null, nothingSet)).toEqual({ asset: true, text: true, timestamp: true });
  });

  it("a value that is already saved stays visible so it can still be changed or cleared", () => {
    expect(fieldsForLayerKind("text", { hasAsset: true, hasText: false, hasTimestamp: true })).toEqual({ asset: true, text: true, timestamp: true });
    expect(fieldsForLayerKind("image", { hasAsset: false, hasText: true, hasTimestamp: false })).toEqual({ asset: true, text: true, timestamp: false });
  });
});
