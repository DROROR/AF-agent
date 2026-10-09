import { describe, expect, it } from "vitest";
import { describeNonContentPlaceholderRefusal, isNonContentPlaceholder, mappingCarriesContent } from "../non-content-placeholder.js";

describe("non-content placeholder (real 2026-10-09: a picture was put on the template's camera)", () => {
  it("is decided by the manifest's own editable flag, nothing else", () => {
    expect(isNonContentPlaceholder({ editable: false })).toBe(true);
    expect(isNonContentPlaceholder({ editable: true })).toBe(false);
  });

  it("says which layer, what it is, and what to do - in a client's words, no codes", () => {
    const sentence = describeNonContentPlaceholderRefusal({ editable: false, layerName: "Camera 1", sourceType: "CameraLayer" }, "a picture");
    expect(sentence).toBe('"Camera 1" is part of the template\'s own setup (a camera) and cannot hold a picture - remove the picture from it on the Scenes tab');
    expect(describeNonContentPlaceholderRefusal({ editable: false, layerName: "Guide", sourceType: null }, "text")).toContain("(a helper layer) and cannot hold text - remove the text");
  });

  it("a mapping carries content when it has a picture or non-blank text", () => {
    expect(mappingCarriesContent({ selectedAssetId: "a", text: null })).toBe("a picture");
    expect(mappingCarriesContent({ selectedAssetId: null, text: "שלום" })).toBe("text");
    expect(mappingCarriesContent({ selectedAssetId: null, text: "   " })).toBeNull();
    expect(mappingCarriesContent({ selectedAssetId: null, text: null })).toBeNull();
  });
});
