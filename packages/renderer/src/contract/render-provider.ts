import type { SceneMap } from "../scene-map/scene-map.js";
import type { ValidationResult } from "../scene-map/validate-scene-map.js";

export const RENDER_OUTPUT_KINDS = ["LANDSCAPE", "REELS"] as const;
export type RenderOutputKind = (typeof RENDER_OUTPUT_KINDS)[number];

/**
 * Provider-neutral render status - each provider maps its own native status
 * vocabulary onto this (see providers/shotstack/shotstack-status.ts for the
 * Shotstack mapping). Never invented per-provider; this is the one set every
 * consumer (e.g. a future dashboard/job system) needs to understand.
 */
export const RENDER_STATUSES = ["QUEUED", "PROCESSING", "DONE", "FAILED"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export interface RenderHandle {
  provider: string;
  externalId: string;
}

export interface RenderStatusResult {
  status: RenderStatus;
  /** The provider's own raw status string, kept for observability/debugging - never used for control flow outside the provider's own mapping function. */
  providerStatus: string;
  outputUrl: string | null;
  message: string | null;
}

export interface PreviewResult {
  previewUrl: string | null;
  handle: RenderHandle | null;
}

export interface PreparedAssets {
  ready: boolean;
  /** placeholderIds that reference no asset/text assignment. */
  missing: string[];
}

/**
 * The smallest contract that lets core project/job/approval logic stay
 * independent of which renderer executes a job - CLAUDE.md Phase 4 (paused)
 * Step 1. See docs/RENDERER-ARCHITECTURE.md for how AfterEffectsRenderer and
 * ShotstackRenderer each satisfy this.
 */
export interface RenderProvider {
  readonly name: string;
  validateProject(sceneMap: SceneMap): Promise<ValidationResult>;
  prepareAssets(sceneMap: SceneMap): Promise<PreparedAssets>;
  createPreview(sceneMap: SceneMap): Promise<PreviewResult>;
  renderLandscape(sceneMap: SceneMap): Promise<RenderHandle>;
  renderReels(sceneMap: SceneMap): Promise<RenderHandle>;
  getRenderStatus(handle: RenderHandle): Promise<RenderStatusResult>;
}
