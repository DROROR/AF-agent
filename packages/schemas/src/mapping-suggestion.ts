import { z } from "zod";
import { placeholderTypeSchema } from "./template-manifest.js";
import { executionPlanResponseSchema } from "./execution-plan-api.js";
import { sceneEvidenceStatusSchema } from "./scene-evidence.js";

/**
 * Mapping Assistant contracts (evidence-backed mapping suggestions phase).
 * Reuses placeholderTypeSchema (template-manifest.ts) and
 * executionPlanResponseSchema (execution-plan-api.ts) rather than
 * inventing parallel shapes - a suggestion is never itself a
 * PlaceholderMapping; it only ever becomes one via the exact same typed
 * MAP_ASSET/SET_TEXT/... execution-plan edit operations a human uses
 * manually (see accept-suggestion.ts), applied only after an explicit
 * human Accept. Never auto-approved, never auto-dispatched to AE.
 */

/**
 * FACT (a real, machine-observed or stored fact - manifest/scene-evidence/
 * asset-catalog data), USER_INTENT (what the client explicitly asked for -
 * Work Map/brand inputs/user instructions), and AI_INFERENCE (a model's
 * own inference) are kept structurally distinct on every evidence item -
 * never collapsed into one undifferentiated field, so a reviewer always
 * knows whether a given reason is an observed fact, a human's stated
 * intent, or a machine guess.
 */
export const EVIDENCE_PROVENANCE_KINDS = ["FACT", "USER_INTENT", "AI_INFERENCE"] as const;
export type EvidenceProvenanceKind = (typeof EVIDENCE_PROVENANCE_KINDS)[number];
export const evidenceProvenanceKindSchema = z.enum(EVIDENCE_PROVENANCE_KINDS);

export const evidenceRefSchema = z
  .object({
    kind: evidenceProvenanceKindSchema,
    summary: z.string().min(1)
  })
  .strict();
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const SUGGESTION_SOURCES = ["DETERMINISTIC", "AI"] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];
export const suggestionSourceSchema = z.enum(SUGGESTION_SOURCES);

export const SUGGESTION_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export const suggestionStatusSchema = z.enum(SUGGESTION_STATUSES);

/**
 * The strict contract every AiSuggestionProvider implementation's output
 * must parse through (section 5: "Provider output must parse through
 * strict schema validation"). Deliberately programmatic/structured data,
 * never a raw natural-language string a provider could smuggle
 * instructions through. `suggestedAssetId` is only ever a candidate - it
 * is independently re-validated server-side against this exact project's
 * real Asset Catalog before it can ever be persisted or accepted (see
 * generate-mapping-suggestions.ts/accept-mapping-suggestion.ts); this
 * schema alone never proves the id is real or same-project.
 */
export const aiSuggestionProposalSchema = z
  .object({
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1).nullable(),
    suggestedClassification: placeholderTypeSchema.nullable(),
    suggestedAssetId: z.string().min(1).nullable(),
    suggestedText: z.string().nullable(),
    suggestedAssetTimestamp: z.number().nonnegative().nullable(),
    suggestedFinalDuration: z.number().positive().nullable(),
    confidence: z.number().min(0).max(1),
    /** A short rationale string - DATA to be displayed to a human reviewer, never itself treated as an instruction to any system. */
    reasoning: z.string().min(1).nullable(),
    /** Never empty - a proposal with no stated evidence is exactly the "invented semantic certainty" this project forbids (same rule as ai-suggestion.ts's own AiSuggestion.evidence). */
    evidenceRefs: z.array(evidenceRefSchema).min(1)
  })
  .strict();
export type AiSuggestionProposal = z.infer<typeof aiSuggestionProposalSchema>;

export const aiSuggestionProposalBatchSchema = z.object({
  proposals: z.array(aiSuggestionProposalSchema)
});
export type AiSuggestionProposalBatch = z.infer<typeof aiSuggestionProposalBatchSchema>;

/**
 * A persisted, reviewable Mapping Assistant suggestion for one unresolved
 * mapping target. `mappingId` is null when the target scene has no
 * detected placeholder mapping at all (a composition-level-only
 * unresolved scene) - there is nothing to attach an asset/text to yet,
 * only a classification/instructions-level suggestion is meaningful.
 */
export const mappingSuggestionSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().uuid(),
    scenePlanId: z.string().min(1),
    mappingId: z.string().min(1).nullable(),
    source: suggestionSourceSchema,
    status: suggestionStatusSchema,
    suggestedClassification: placeholderTypeSchema.nullable(),
    suggestedAssetId: z.string().min(1).nullable(),
    suggestedText: z.string().nullable(),
    suggestedAssetTimestamp: z.number().nonnegative().nullable(),
    suggestedFinalDuration: z.number().positive().nullable(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().nullable(),
    evidenceRefs: z.array(evidenceRefSchema),
    /** Populated instead of a confident proposal when nothing conclusive could be determined - "unknown" stays a first-class, valid outcome, never silently blank. */
    unresolvedReason: z.string().nullable(),
    requiresHumanReview: z.boolean(),
    /** True when a Work Map entry for this same scene explicitly names a DIFFERENT asset/text than this suggestion proposes - Work Map is user intent and outranks inference (section 11 of the mapping-assistant phase); never silently resolved either way, always surfaced to the reviewer. */
    conflictsWithWorkMap: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();
export type MappingSuggestion = z.infer<typeof mappingSuggestionSchema>;

/** POST /api/projects/:projectId/mapping-suggestions/generate - no request body: operates over the project's own current plan/assets/work-map/brand-inputs, never client-supplied targeting. */
export const generateMappingSuggestionsRequestSchema = z.object({});
export type GenerateMappingSuggestionsRequest = z.infer<typeof generateMappingSuggestionsRequestSchema>;

export const listMappingSuggestionsResponseSchema = z.object({
  suggestions: z.array(mappingSuggestionSchema),
  /** True only when a real AI provider is actually configured - the UI must never claim AI ran when it was structurally unavailable and only deterministic matching executed. */
  aiAvailable: z.boolean(),
  /**
   * Keyed by manifestCompositionId, covering every scene in the project's
   * current plan - never omits a scene just because it has no evidence
   * (NOT_INSPECTED is itself a first-class, honestly-reported value, same
   * pattern as `unresolvedReason` on a suggestion).
   */
  sceneEvidenceAvailability: z.record(z.string(), sceneEvidenceStatusSchema)
});
export type ListMappingSuggestionsResponse = z.infer<typeof listMappingSuggestionsResponseSchema>;

export const generateMappingSuggestionsResponseSchema = listMappingSuggestionsResponseSchema;
export type GenerateMappingSuggestionsResponse = ListMappingSuggestionsResponse;

export const acceptMappingSuggestionRequestSchema = z.object({ baseRevision: z.number().int().positive() });
export type AcceptMappingSuggestionRequest = z.infer<typeof acceptMappingSuggestionRequestSchema>;

export const acceptMappingSuggestionResponseSchema = z.object({
  suggestion: mappingSuggestionSchema,
  executionPlan: executionPlanResponseSchema
});
export type AcceptMappingSuggestionResponse = z.infer<typeof acceptMappingSuggestionResponseSchema>;

export const rejectMappingSuggestionResponseSchema = z.object({ suggestion: mappingSuggestionSchema });
export type RejectMappingSuggestionResponse = z.infer<typeof rejectMappingSuggestionResponseSchema>;

/** Accepts several PENDING suggestions as one batched plan revision bump - never partial: if any referenced suggestion is invalid/stale/not-PENDING, the whole batch is refused before any edit is applied. */
export const batchAcceptMappingSuggestionsRequestSchema = z.object({
  baseRevision: z.number().int().positive(),
  suggestionIds: z.array(z.string().min(1)).min(1)
});
export type BatchAcceptMappingSuggestionsRequest = z.infer<typeof batchAcceptMappingSuggestionsRequestSchema>;

export const batchAcceptMappingSuggestionsResponseSchema = z.object({
  suggestions: z.array(mappingSuggestionSchema),
  executionPlan: executionPlanResponseSchema
});
export type BatchAcceptMappingSuggestionsResponse = z.infer<typeof batchAcceptMappingSuggestionsResponseSchema>;
