import { z } from "zod";
import { textCaptureStatusSchema, textVerificationSchema } from "./text-digest.js";

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

/**
 * (Defined here rather than in execution-plan.ts - which imports FROM this
 * module - so a manifest Placeholder can carry the same step shape without
 * a circular import. execution-plan.ts uses this exact schema.)
 *
 * One step of a deterministic nested AE target path (live QA brand-rule
 * blocker fix, 2026-09-08 correction: the real logo layer for the exact
 * project this fix was built for lives 4 compositions deep - !Render >
 * Scene 1 > Pre-comp 3 > App Emblem > App Logo > layer 1 - never
 * reachable by a single same-composition layerIndex). `compositionId` is
 * a real, manifest-verified composition (apply-execution-plan-edit.ts
 * checks every step's compositionId actually exists AND is a real child -
 * via manifest evidence, compositions[].parentCompositionIds, never a
 * name guess - of the PREVIOUS step's compositionId, or of the owning
 * scene's own manifestCompositionId for the first step). `layerIndex` is
 * the real AE layer within THAT composition: for every step except the
 * last, the layer that IS the nested-composition reference to descend
 * through next; for the last step, the real target content layer itself.
 */
export const nestedTargetStepSchema = z
  .object({
    compositionId: z.string().min(1),
    layerIndex: z.number().int().nonnegative()
  })
  .strict();
export type NestedTargetStep = z.infer<typeof nestedTargetStepSchema>;

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
  /**
   * The machine-usable counterpart to `layerPath` (2026-09-13). `layerPath`
   * holds composition NAMES for humans; execution cannot address a layer by
   * name. When this placeholder's layer lives inside a nested composition
   * (so `compositionId` is that nested composition, not the scene's own),
   * this is the exact verified chain resolve-execute-frame-dispatch.ts turns
   * into a real nested edit - identical semantics to a mapping's
   * humanNestedTarget (see nestedTargetStepSchema above): it never includes
   * the scene's own composition, and its last step is always
   * `{ compositionId, layerIndex }` of this placeholder itself.
   *
   * Null/absent means the layer sits directly in the scene's own
   * composition. Optional so every manifest persisted before this field
   * existed still parses - and dispatch independently refuses any
   * placeholder whose compositionId is not the scene's own but which carries
   * no chain, so a manifest that lost this field (e.g. stripped by an older
   * API) fails closed instead of editing the wrong layer.
   */
  nestedTarget: z.array(nestedTargetStepSchema).min(1).nullable().optional(),
  placeholderType: placeholderTypeSchema,
  editable: z.boolean(),
  /** Raw AE layer type (e.g. "TextLayer", "AVLayer") - a machine fact, not a classification. */
  sourceType: z.string().nullable(),
  /**
   * The untouched template layer's own text IN FULL, exactly as the source
   * project stores it - code point for code point, never trimmed, folded or
   * normalised. This is what leftover-template-copy detection compares an
   * approved mapping against (see template-copy.ts).
   *
   * THREE DISTINCT STATES, deliberately: a string is the complete captured
   * text; `null` means "captured, and this placeholder is not a text layer";
   * ABSENT means the complete text is not stored here - either this manifest
   * predates template-text capture, or the text was longer than the storage
   * bound, in which case `originalTextPreview` and `originalTextVerification`
   * carry the bounded display value and the metadata that still makes it
   * verifiable. Optional so every manifest written before this field existed
   * still parses unchanged.
   */
  originalText: z.string().nullable().optional(),
  /**
   * A BOUNDED, display-only excerpt of a text too long to store in full.
   * Present only when `originalTextTruncated` is true, and never compared
   * with anything: comparison uses `originalTextVerification`, which is
   * computed from the complete text. Any UI showing this must label it as an
   * excerpt, never as the original.
   */
  originalTextPreview: z.string().optional(),
  /** True when the complete text exceeded the storage bound, so `originalText` is absent and `originalTextPreview`/`originalTextVerification` carry the excerpt and the metadata instead. */
  originalTextTruncated: z.boolean().optional(),
  /**
   * Digests and exact length computed from the COMPLETE, untruncated template
   * text at inspection time (see text-digest.ts), so a text too long to store
   * is still fully verifiable - identical, case-only variant,
   * whitespace-only variant, or genuinely different - without storing it.
   *
   * REAL 2026-09-19 CORRECTION: without this, a text longer than the bound
   * blocked approval with "re-run template inspection", which could never
   * help, because re-inspecting truncates the same layer again. Only a
   * manifest carrying NEITHER the complete text NOR this metadata genuinely
   * needs re-inspection.
   *
   * `sourceProjectSha256` ties the evidence to the exact immutable source
   * that was inspected: metadata captured from a different source revision is
   * never silently trusted against this one.
   */
  originalTextVerification: textVerificationSchema.extend({ sourceProjectSha256: z.string().min(1) }).optional(),
  /**
   * How completely this layer's text was captured, so the gate can give
   * DIFFERENT advice for cases that need it (2026-09-19 integrity
   * correction): `COMPLETE`, `VERIFIED_EXCERPT`, a transient `CAPTURE_FAILED`
   * that re-inspection may resolve, or a terminal `TOO_LARGE` that it never
   * can. An absent status means the manifest predates text capture entirely.
   */
  originalTextCaptureStatus: textCaptureStatusSchema.optional(),
  /** The COMPLETE text's own code-unit length, recorded even when the text itself is not stored - evidence for an operator deciding what to do about an over-sized layer. */
  originalTextCodeUnitLength: z.number().int().nonnegative().optional(),
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
  /** Raw, 1-based app.project.item(n) position - the SAME runtime locator ae_get_composition/ae_get_layer's own comp_index argument expects (confirmed directly from the real upstream host script - see execute-scene-edit.ts's own doc comment on canonical composition addressing). compositionId remains the durable identity; this is only the short-lived runtime locator, verified against this composition's own `name` before any later mutation/render ever trusts it. */
  aeProjectItemIndex: z.number().int().positive(),
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
