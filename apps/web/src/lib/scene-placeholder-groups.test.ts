import { describe, expect, it } from "vitest";
import { groupMappingsByLayerPath, placeholderGroupPathLabel } from "./scene-placeholder-groups";

describe("groupMappingsByLayerPath", () => {
  it("returns no groups for no mappings", () => {
    expect(groupMappingsByLayerPath([])).toEqual([]);
  });

  it("puts every layer that is not nested into one group keyed by the empty path", () => {
    const groups = groupMappingsByLayerPath([
      { mappingId: "m1", layerPath: [] },
      { mappingId: "m2", layerPath: [] }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.layerPath).toEqual([]);
    expect(groups[0]?.mappingIds).toEqual(["m1", "m2"]);
  });

  it("separates two different nested compositions", () => {
    const groups = groupMappingsByLayerPath([
      { mappingId: "m1", layerPath: ["outer", "first"] },
      { mappingId: "m2", layerPath: ["outer", "second"] },
      { mappingId: "m3", layerPath: ["outer", "first"] }
    ]);
    expect(groups.map((group) => group.mappingIds)).toEqual([["m1", "m3"], ["m2"]]);
  });

  it("keeps the scene's own layers first even when a nested layer came first", () => {
    const groups = groupMappingsByLayerPath([
      { mappingId: "nested", layerPath: ["outer", "inner"] },
      { mappingId: "own", layerPath: [] }
    ]);
    expect(groups[0]?.mappingIds).toEqual(["own"]);
    expect(groups[1]?.mappingIds).toEqual(["nested"]);
  });

  it("preserves first-appearance order of nested groups rather than sorting them", () => {
    const groups = groupMappingsByLayerPath([
      { mappingId: "m1", layerPath: ["z"] },
      { mappingId: "m2", layerPath: ["a"] }
    ]);
    expect(groups.map((group) => group.layerPath)).toEqual([["z"], ["a"]]);
  });

  it("treats a mapping with no manifest origin as one of the scene's own layers, never dropping it", () => {
    const groups = groupMappingsByLayerPath([{ mappingId: "human", layerPath: null }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.layerPath).toEqual([]);
    expect(groups[0]?.mappingIds).toEqual(["human"]);
  });

  it("does not merge two paths that share an innermost name but differ further out", () => {
    const groups = groupMappingsByLayerPath([
      { mappingId: "m1", layerPath: ["first", "shared"] },
      { mappingId: "m2", layerPath: ["second", "shared"] }
    ]);
    expect(groups).toHaveLength(2);
  });

  it("does not merge paths whose names would collide if joined by a printable separator", () => {
    const groups = groupMappingsByLayerPath([
      { mappingId: "m1", layerPath: ["a › b"] },
      { mappingId: "m2", layerPath: ["a", "b"] }
    ]);
    expect(groups).toHaveLength(2);
  });

  it("never loses a mapping", () => {
    const inputs = [
      { mappingId: "m1", layerPath: [] },
      { mappingId: "m2", layerPath: ["x"] },
      { mappingId: "m3", layerPath: ["x", "y"] },
      { mappingId: "m4", layerPath: ["x"] }
    ];
    const groups = groupMappingsByLayerPath(inputs);
    expect(groups.flatMap((group) => group.mappingIds).sort()).toEqual(["m1", "m2", "m3", "m4"]);
  });
});

describe("placeholderGroupPathLabel", () => {
  it("joins the path outermost first", () => {
    expect(placeholderGroupPathLabel({ key: "k", layerPath: ["outer", "inner"], mappingIds: [] })).toBe("outer › inner");
  });

  it("is empty for the scene's own layers, so the caller supplies its own wording", () => {
    expect(placeholderGroupPathLabel({ key: "", layerPath: [], mappingIds: [] })).toBe("");
  });
});
