import { z } from "zod";

/**
 * Provider-neutral scene-map model - CLAUDE.md Phase 4 (paused) Step 3:
 * "Reference Video -> scenes -> durations -> editable placeholders -> asset
 * assignments -> text -> phone positions -> transition/motion instructions."
 *
 * This describes WHAT a video should contain, independent of whether it is
 * executed by the After Effects renderer or the Shotstack renderer - see
 * docs/RENDERER-ARCHITECTURE.md. It is deliberately small: it is a target
 * shape both providers translate into their own native representation, not
 * a general-purpose video-editing schema.
 */

export const ASSET_TYPES = ["IMAGE", "VIDEO", "LOGO"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const assetTypeSchema = z.enum(ASSET_TYPES);

export const PHONE_POSITIONS = ["LEFT", "CENTER", "RIGHT", "FULL_SCREEN"] as const;
export type PhonePosition = (typeof PHONE_POSITIONS)[number];
export const phonePositionSchema = z.enum(PHONE_POSITIONS);

export const TRANSITION_TYPES = ["NONE", "FADE", "SLIDE", "ZOOM"] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const transitionSchema = z.object({
  type: z.enum(TRANSITION_TYPES),
  durationMs: z.number().int().positive().optional()
});
export type Transition = z.infer<typeof transitionSchema>;

export const assetAssignmentSchema = z.object({
  placeholderId: z.string().min(1),
  assetType: assetTypeSchema,
  sourceUrl: z.string().url()
});
export type AssetAssignment = z.infer<typeof assetAssignmentSchema>;

export const textAssignmentSchema = z.object({
  placeholderId: z.string().min(1),
  content: z.string().min(1),
  color: z.string().min(1).optional(),
  fontFamily: z.string().min(1).optional(),
  /** Numeric font-weight axis value (100-900), e.g. 700 for Bold. */
  fontWeight: z.number().int().min(100).max(900).optional()
});
export type TextAssignment = z.infer<typeof textAssignmentSchema>;

export const sceneSchema = z.object({
  sceneId: z.string().min(1),
  label: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  assets: z.array(assetAssignmentSchema).default([]),
  texts: z.array(textAssignmentSchema).default([]),
  phonePosition: phonePositionSchema.optional(),
  transitionIn: transitionSchema.optional(),
  transitionOut: transitionSchema.optional()
});
export type Scene = z.infer<typeof sceneSchema>;

export const sceneMapSchema = z.object({
  projectId: z.string().min(1),
  /** DYO brand rule (CLAUDE.md "Permanent DYO Brand Rules"): the official DYO blue, or the client brand color for the rest of the video. */
  brandColor: z.string().min(1),
  logoAssetUrl: z.string().url().optional(),
  scenes: z.array(sceneSchema).min(1)
});
export type SceneMap = z.infer<typeof sceneMapSchema>;
