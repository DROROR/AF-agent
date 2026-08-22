import { describe, expect, it } from "vitest";
import { AfterEffectsRenderer } from "./providers/after-effects/after-effects-renderer.js";
import { RendererConfigError } from "./errors.js";
import { selectRenderProvider } from "./provider-selection.js";
import { ShotstackClient } from "./providers/shotstack/shotstack-client.js";
import { ShotstackRenderer } from "./providers/shotstack/shotstack-renderer.js";

describe("selectRenderProvider", () => {
  const afterEffects = new AfterEffectsRenderer();
  const shotstack = new ShotstackRenderer(
    new ShotstackClient({ apiKey: "test", baseUrl: "https://api.shotstack.io/edit/stage", env: "sandbox" })
  );
  const providers = { "after-effects": afterEffects, shotstack };

  it("resolves after-effects to the AfterEffectsRenderer instance", () => {
    expect(selectRenderProvider("after-effects", providers)).toBe(afterEffects);
  });

  it("resolves shotstack to the ShotstackRenderer instance", () => {
    expect(selectRenderProvider("shotstack", providers)).toBe(shotstack);
  });

  it("throws RendererConfigError for a provider name not present in the map", () => {
    const incomplete = { "after-effects": afterEffects } as unknown as Parameters<
      typeof selectRenderProvider
    >[1];
    expect(() => selectRenderProvider("shotstack", incomplete)).toThrow(RendererConfigError);
  });
});
