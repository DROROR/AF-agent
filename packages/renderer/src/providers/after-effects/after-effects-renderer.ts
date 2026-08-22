import type {
  PreparedAssets,
  PreviewResult,
  RenderHandle,
  RenderProvider,
  RenderStatusResult
} from "../../contract/render-provider.js";
import { RendererNotImplementedError } from "../../errors.js";
import type { SceneMap } from "../../scene-map/scene-map.js";
import { validateSceneMap, type ValidationResult } from "../../scene-map/validate-scene-map.js";

/**
 * The production renderer. Preserves the existing locked architecture:
 * asset preparation, preview, and rendering are executed by the real DYO
 * Windows Worker + ae-mcp + aerender pipeline (apps/worker), which requires
 * the client's physical machine - currently blocked, see docs/AUDIT.md
 * "Phase 4 status update".
 *
 * `validateProject` is genuinely implemented here (it's pure, provider-
 * agnostic business logic - no AE dependency). Every other method throws
 * RendererNotImplementedError rather than fabricating a result, per
 * CLAUDE.md Phase 4's explicit "do not fabricate health/status results".
 * This class exists to prove After Effects fits the same RenderProvider
 * contract Shotstack does - it is not a working implementation in this
 * environment, and it must not become one without the real worker/AE
 * pipeline behind it.
 */
export class AfterEffectsRenderer implements RenderProvider {
  readonly name = "after-effects";

  async validateProject(sceneMap: SceneMap): Promise<ValidationResult> {
    return validateSceneMap(sceneMap);
  }

  async prepareAssets(): Promise<PreparedAssets> {
    throw this.notImplemented(
      "prepareAssets requires the real Windows worker/After Effects project (apps/worker)"
    );
  }

  async createPreview(): Promise<PreviewResult> {
    throw this.notImplemented("createPreview requires the real Windows worker/After Effects pipeline");
  }

  async renderLandscape(): Promise<RenderHandle> {
    throw this.notImplemented("renderLandscape requires the real aerender pipeline");
  }

  async renderReels(): Promise<RenderHandle> {
    throw this.notImplemented("renderReels requires the real aerender pipeline");
  }

  async getRenderStatus(): Promise<RenderStatusResult> {
    throw this.notImplemented("getRenderStatus requires the real aerender pipeline");
  }

  private notImplemented(message: string): RendererNotImplementedError {
    return new RendererNotImplementedError(this.name, message);
  }
}
