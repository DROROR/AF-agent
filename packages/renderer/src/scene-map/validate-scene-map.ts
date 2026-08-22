import type { SceneMap } from "./scene-map.js";

/**
 * CLAUDE.md "Permanent DYO Brand Rules": every video must include Hebrew
 * text reading "By DYO App". Single source of truth for this literal string
 * - see docs/engineering/CODE_STANDARDS.md ("do not duplicate ... DYO
 * branding rules").
 */
export const DYO_REQUIRED_HEBREW_TEXT = "מבית DYO App";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function hasLogo(sceneMap: SceneMap): boolean {
  if (sceneMap.logoAssetUrl) {
    return true;
  }
  return sceneMap.scenes.some((scene) => scene.assets.some((asset) => asset.assetType === "LOGO"));
}

function hasRequiredHebrewText(sceneMap: SceneMap): boolean {
  return sceneMap.scenes.some((scene) =>
    scene.texts.some((text) => text.content.includes(DYO_REQUIRED_HEBREW_TEXT))
  );
}

/**
 * Provider-agnostic rules every renderer must satisfy, regardless of
 * whether After Effects or Shotstack executes the render - see
 * docs/RENDERER-ARCHITECTURE.md ("what can be reused"). Zod already
 * validates shape (packages/renderer/src/scene-map/scene-map.ts); this
 * validates cross-field business rules zod alone can't express.
 */
export function validateSceneMap(sceneMap: SceneMap): ValidationResult {
  const errors: string[] = [];

  if (sceneMap.scenes.length === 0) {
    errors.push("A scene map must contain at least one scene.");
  }

  for (const scene of sceneMap.scenes) {
    if (scene.durationMs <= 0) {
      errors.push(`Scene "${scene.sceneId}" must have a positive duration.`);
    }
  }

  if (!hasLogo(sceneMap)) {
    errors.push(
      "The client/company logo must appear at least once in every video (CLAUDE.md brand rule)."
    );
  }

  if (!hasRequiredHebrewText(sceneMap)) {
    errors.push(
      `Every video must include the Hebrew text "${DYO_REQUIRED_HEBREW_TEXT}" (CLAUDE.md brand rule).`
    );
  }

  return { valid: errors.length === 0, errors };
}
