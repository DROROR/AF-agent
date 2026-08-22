import type {
  PreparedAssets,
  PreviewResult,
  RenderHandle,
  RenderProvider,
  RenderStatusResult
} from "../../contract/render-provider.js";
import type { SceneMap } from "../../scene-map/scene-map.js";
import { validateSceneMap, type ValidationResult } from "../../scene-map/validate-scene-map.js";
import { ShotstackClient } from "./shotstack-client.js";
import { buildShotstackEditPayload, type BuildShotstackEditPayloadOptions } from "./shotstack-payload.js";
import { mapShotstackStatus } from "./shotstack-status.js";

function findMissingPlaceholders(sceneMap: SceneMap): string[] {
  const missing: string[] = [];
  for (const scene of sceneMap.scenes) {
    if (scene.assets.length === 0 && scene.texts.length === 0) {
      missing.push(scene.sceneId);
    }
  }
  return missing;
}

/**
 * Experimental POC provider - CLAUDE.md Phase 4 (paused) Step 2. Unlike
 * AfterEffectsRenderer, every method here is a real (if minimal) working
 * implementation, backed by the real Shotstack Edit API - see
 * docs/SHOTSTACK-POC.md for exactly what was verified vs. not. A live
 * sandbox render (scripts/shotstack/typography-smoke-test.ts) confirmed
 * Hebrew+Heebo rich-text rendering end to end; unit tests here still run
 * against a mocked HTTP layer for speed/determinism.
 *
 * `createPreview` is a known simplification: Shotstack's Edit API has no
 * separate lightweight "preview" endpoint that was verified in this POC, so
 * this just triggers a real landscape render and returns its handle. This is
 * documented as a fidelity/limitation gap, not treated as a true preview
 * mechanism.
 */
export class ShotstackRenderer implements RenderProvider {
  readonly name = "shotstack";

  constructor(
    private readonly client: ShotstackClient,
    private readonly payloadOptions: BuildShotstackEditPayloadOptions = {}
  ) {}

  async validateProject(sceneMap: SceneMap): Promise<ValidationResult> {
    return validateSceneMap(sceneMap);
  }

  async prepareAssets(sceneMap: SceneMap): Promise<PreparedAssets> {
    const missing = findMissingPlaceholders(sceneMap);
    return { ready: missing.length === 0, missing };
  }

  async createPreview(sceneMap: SceneMap): Promise<PreviewResult> {
    const handle = await this.renderLandscape(sceneMap);
    return { previewUrl: null, handle };
  }

  async renderLandscape(sceneMap: SceneMap): Promise<RenderHandle> {
    const payload = buildShotstackEditPayload(sceneMap, "LANDSCAPE", this.payloadOptions);
    const { id } = await this.client.createRender(payload);
    return { provider: this.name, externalId: id };
  }

  async renderReels(sceneMap: SceneMap): Promise<RenderHandle> {
    const payload = buildShotstackEditPayload(sceneMap, "REELS", this.payloadOptions);
    const { id } = await this.client.createRender(payload);
    return { provider: this.name, externalId: id };
  }

  async getRenderStatus(handle: RenderHandle): Promise<RenderStatusResult> {
    const raw = await this.client.getRenderStatus(handle.externalId);
    return {
      status: mapShotstackStatus(raw.status),
      providerStatus: raw.status,
      outputUrl: raw.url,
      message: raw.error
    };
  }
}
