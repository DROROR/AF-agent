import { describe, expect, it } from "vitest";
import type { PlaceholderMapping, ScenePlanEntry, TemplateManifest } from "@dyo/schemas";
import type { RealScene } from "./real-scene-grouping";
import { resolveSceneMappingHomes } from "./scene-mapping-homes";

/**
 * Real complaint, 2026-10-02: a single-master template put all 28 layers
 * and all 28 suggestions on the master's one card, while each of the
 * master's parts said "Nothing to change here".
 */

type Placeholder = TemplateManifest["scenes"][number]["placeholders"][number];

function mapping(id: string, manifestPlaceholderId: string | null): PlaceholderMapping {
  return { id, manifestPlaceholderId, placeholderName: id } as unknown as PlaceholderMapping;
}

function placeholder(placeholderId: string, chain: string[] | null): Placeholder {
  return {
    placeholderId,
    nestedTarget: chain === null ? null : chain.map((compositionId, index) => ({ compositionId, layerIndex: index + 1 }))
  } as unknown as Placeholder;
}

function realScene(compositionId: string, mappings: PlaceholderMapping[]): RealScene {
  return {
    manifestCompositionId: compositionId,
    sceneName: compositionId,
    scenePlan: { id: `plan-${compositionId}`, manifestCompositionId: compositionId, mappings } as unknown as ScenePlanEntry,
    nested: []
  };
}

function manifestWith(placeholders: Placeholder[]): TemplateManifest {
  return { scenes: [{ placeholders }] } as unknown as TemplateManifest;
}

describe("resolveSceneMappingHomes", () => {
  const master = realScene("master", [mapping("m-own", "ph-own"), mapping("m-a1", "ph-a1"), mapping("m-a2", "ph-a2"), mapping("m-b", "ph-b"), mapping("m-deep", "ph-deep"), mapping("m-stray", "ph-stray")]);
  const partA = realScene("part-a", []);
  const partB = realScene("part-b", []);
  const manifest = manifestWith([
    placeholder("ph-own", null),
    placeholder("ph-a1", ["part-a", "inner-1"]),
    placeholder("ph-a2", ["part-a", "inner-1"]),
    placeholder("ph-b", ["part-b"]),
    placeholder("ph-deep", ["part-b", "inner-2", "inner-3", "inner-4"]),
    placeholder("ph-stray", ["no-card-for-this", "inner-9"])
  ]);
  const homes = resolveSceneMappingHomes(manifest, [master, partA, partB]);
  const shownOn = (compositionId: string): string[] => (homes.mappingsByCardId.get(`plan-${compositionId}`) ?? []).map((hosted) => hosted.mapping.id);

  it("shows a nested layer on the card of the part it actually appears in", () => {
    expect(shownOn("part-a")).toEqual(["m-a1", "m-a2"]);
  });

  it("follows only the FIRST step of the chain, however deep the layer sits", () => {
    expect(shownOn("part-b")).toEqual(["m-b", "m-deep"]);
  });

  it("leaves the master with only its own layers and any whose part has no card", () => {
    expect(shownOn("master")).toEqual(["m-own", "m-stray"]);
  });

  it("never changes ownership - every hosted layer still names the scene plan that owns it", () => {
    for (const hosted of homes.mappingsByCardId.get("plan-part-a") ?? []) {
      expect(hosted.ownerScenePlanId).toBe("plan-master");
    }
  });

  it("every layer is shown exactly once - none dropped, none duplicated", () => {
    const all = [...homes.mappingsByCardId.values()].flat().map((hosted) => hosted.mapping.id);
    expect([...all].sort()).toEqual(["m-a1", "m-a2", "m-b", "m-deep", "m-own", "m-stray"]);
    expect(homes.cardIdByMappingId.get("m-a1")).toBe("plan-part-a");
    expect(homes.cardIdByMappingId.get("m-own")).toBe("plan-master");
  });

  it("a template with an ordinary scene-per-composition layout is unchanged", () => {
    const one = realScene("one", [mapping("m1", "p1")]);
    const two = realScene("two", [mapping("m2", "p2")]);
    const plain = resolveSceneMappingHomes(manifestWith([placeholder("p1", null), placeholder("p2", null)]), [one, two]);
    expect((plain.mappingsByCardId.get("plan-one") ?? []).map((h) => h.mapping.id)).toEqual(["m1"]);
    expect((plain.mappingsByCardId.get("plan-two") ?? []).map((h) => h.mapping.id)).toEqual(["m2"]);
  });

  it("a mapping with no manifest placeholder stays on its own card", () => {
    const lone = realScene("lone", [mapping("m-x", null)]);
    expect((resolveSceneMappingHomes(manifestWith([]), [lone]).mappingsByCardId.get("plan-lone") ?? []).map((h) => h.mapping.id)).toEqual(["m-x"]);
  });
});
