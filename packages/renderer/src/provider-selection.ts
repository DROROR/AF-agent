import type { RenderProvider } from "./contract/render-provider.js";
import { RendererConfigError } from "./errors.js";

export const RENDER_PROVIDER_NAMES = ["after-effects", "shotstack"] as const;
export type RenderProviderName = (typeof RENDER_PROVIDER_NAMES)[number];

/**
 * Deliberately simple: no runtime registry/DI framework, just a lookup in a
 * caller-supplied map - this is a POC, not a production job dispatcher (no
 * job execution system exists yet to plug this into).
 */
export function selectRenderProvider(
  name: RenderProviderName,
  providers: Record<RenderProviderName, RenderProvider>
): RenderProvider {
  const provider = providers[name];
  if (!provider) {
    throw new RendererConfigError(`Unknown render provider: ${name}`);
  }
  return provider;
}
