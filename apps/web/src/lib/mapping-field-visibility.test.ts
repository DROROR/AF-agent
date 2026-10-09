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

// REAL 2026-10-09: the template's camera, with no kind, was "offered everything" and given a picture; the first frame then failed.
describe("fieldsForLayerKind - a layer that is not a place for content", () => {
  it("offers nothing, whatever its kind says", () => {
    expect(fieldsForLayerKind(null, nothingSet, { nonContent: true })).toEqual({ asset: false, text: false, timestamp: false });
    expect(fieldsForLayerKind("image", nothingSet, { nonContent: true })).toEqual({ asset: false, text: false, timestamp: false });
  });

  it("still shows a value already saved on it, so it can be cleared", () => {
    expect(fieldsForLayerKind(null, { hasAsset: true, hasText: false, hasTimestamp: false }, { nonContent: true })).toEqual({ asset: true, text: false, timestamp: false });
  });

  it("an unknown kind that IS a place for content is offered everything, as before", () => {
    expect(fieldsForLayerKind(null, nothingSet)).toEqual({ asset: true, text: true, timestamp: true });
  });
});
