import { z } from "zod";

/**
 * template-manifest.json - machine-generated scene/placeholder discovery,
 * kept separate from human approval (execution-plan.json) per CLAUDE.md's
 * "Required Data Model". Shape follows the illustrative sketch in
 * docs/SCHEMAS.md, extended to the field-by-field detail Phase 5 requires.
 *
 * `displayName`/`displayLabel` fields exist because docs/SCHEMAS.md's
 * illustrative shape includes them (e.g. a scene's "Scene 05", a
 * placeholder's "Left Phone") - but nothing in this schema module ever
 * *fills them in*. They stay null from automated inspection; only a later,
 * separate human-approval step may assign them. Inventing a semantic label
 * like "Left Phone" from AE structure alone is exactly what this project's
 * instructions forbid unless the structure itself actually supports it.
 */

export const SCHEMA_VERSION = "1.0";

/** How a fact in the manifest was determined - keeps machine-read facts distinguishable from inferred/uncertain ones. */
export const EVIDENCE_SOURCES = ["read_directly", "inferred", "unknown"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export const evidenceSourceSchema = z.enum(EVIDENCE_SOURCES);

export const evidenceSchema = z.object({
  source: evidenceSourceSchema,
  reason: z.string().min(1)
});
export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * "phone/screen" here names a placeholder *type category* (the task's own
 * enum), not a semantic scene label like "Left Phone" - those two things
 * are not the same. See the module doc comment above.
 */
export const PLACEHOLDER_TYPES = ["image", "video", "text", "logo", "phone_screen", "color", "unknown"] as const;
export type PlaceholderType = (typeof PLACEHOLDER_TYPES)[number];
export const placeholderTypeSchema = z.enum(PLACEHOLDER_TYPES);

export const dimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive()
});

export const placeholderSchema = z.object({
  /** Stable, independent of any human display label - CLAUDE.md "Required Data Model". */
  placeholderId: z.string().min(1),
  /** Never auto-filled by inspection - human/approval-stage only. */
  displayLabel: z.string().nullable(),
  compositionId: z.string().min(1),
  layerName: z.string(),
  /** Every AE layer has an index; kept for deterministic targeting when layer names duplicate within a comp. */
  layerIndex: z.number().int().nonnegative(),
  /** Nesting context by composition, outermost first - e.g. ["Main Comp", "Phone Mockup"] for a layer inside a precomp inside a precomp. Empty = directly in the composition named by compositionId. */
  layerPath: z.array(z.string()),
  placeholderType: placeholderTypeSchema,
  editable: z.boolean(),
  /** Raw AE layer type (e.g. "TextLayer", "AVLayer") - a machine fact, not a classification. */
  sourceType: z.string().nullable(),
  dimensions: dimensionsSchema.nullable(),
  startTimeSeconds: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  evidence: evidenceSchema
});
export type Placeholder = z.infer<typeof placeholderSchema>;

export const sceneSchema = z.object({
  /** Stable, independent of any human display label. */
  sceneId: z.string().min(1),
  /** Never auto-filled by inspection - human/approval-stage only. */
  displayName: z.string().nullable(),
  compositionId: z.string().min(1),
  /** Position in the original AE project structure - never re-derived or re-sorted. */
  originalOrderIndex: z.number().int().nonnegative(),
  startTimeSeconds: z.number(),
  durationSeconds: z.number(),
  placeholders: z.array(placeholderSchema)
});
export type Scene = z.infer<typeof sceneSchema>;

export const compositionSchema = z.object({
  compositionId: z.string().min(1),
  name: z.string(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  durationSeconds: z.number().nonnegative(),
  frameRate: z.number().positive(),
  /** True if this composition is only ever referenced as a nested layer source, never a top-level scene candidate. */
  isNestedOnlyReferenced: z.boolean(),
  /** Compositions that reference this one as a layer source - empty if never nested. */
  parentCompositionIds: z.array(z.string())
});
export type Composition = z.infer<typeof compositionSchema>;

export const missingFootageSchema = z.object({
  name: z.string(),
  expectedPath: z.string().nullable()
});
export type MissingFootage = z.infer<typeof missingFootageSchema>;

export const preflightSummarySchema = z.object({
  requiredFonts: z.array(z.string()),
  footageReferenced: z.array(z.string()),
  missingFootage: z.array(missingFootageSchema),
  pluginReferences: z.array(z.string())
});
export type PreflightSummary = z.infer<typeof preflightSummarySchema>;

export const unknownItemSchema = z.object({
  context: z.string().min(1),
  reason: z.string().min(1)
});
export type UnknownItem = z.infer<typeof unknownItemSchema>;

export const sourceProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  /** Hash of the source .aep at inspection time - CLAUDE.md Safety Rule 8 ("hash source .aep files ... verify originals remain unchanged"). */
  sha256: z.string().min(1)
});
export type SourceProject = z.infer<typeof sourceProjectSchema>;

export const templateManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  templateId: z.string().min(1),
  templateName: z.string(),
  sourceProject: sourceProjectSchema,
  afterEffects: z.object({ version: z.string().nullable() }),
  generatedAt: z.string().datetime(),
  compositions: z.array(compositionSchema),
  scenes: z.array(sceneSchema),
  preflight: preflightSummarySchema,
  unknownItems: z.array(unknownItemSchema)
});
export type TemplateManifest = z.infer<typeof templateManifestSchema>;
