import { z } from "zod";
import { placeholderTypeSchema } from "./template-manifest.js";

/**
 * Strict output contract for a future AI mapping-suggestion provider
 * (Phase 4 section 11: "AI output must be parsed through strict schemas
 * and becomes a suggestion only. Human approval remains authoritative.").
 * No provider is integrated yet - this schema exists so the seam is real
 * and typed the moment one is added, never a loosely-typed placeholder.
 * An AI suggestion can never itself become a PlaceholderMapping; it can
 * only ever be turned into one via the same typed MAP_ASSET/SET_TEXT/...
 * edit operations a human uses (execution-plan-edit.ts), with
 * mappingSource recorded as "AI_SUGGESTION" - never a separate, less-
 * validated write path.
 */
export const aiSuggestionSchema = z.object({
  manifestCompositionId: z.string().min(1),
  manifestPlaceholderId: z.string().min(1).nullable(),
  suggestedClassification: placeholderTypeSchema.nullable(),
  suggestedText: z.string().nullable(),
  suggestedAssetId: z.string().min(1).nullable(),
  suggestedAssetType: placeholderTypeSchema.nullable(),
  suggestedAssetTimestamp: z.number().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  /** Never empty - a suggestion with no stated evidence is exactly the "invented semantic certainty" this project forbids. */
  evidence: z.array(z.string().min(1)).min(1)
});
export type AiSuggestion = z.infer<typeof aiSuggestionSchema>;

export const aiSuggestionBatchSchema = z.object({
  templateId: z.string().min(1),
  sourceProjectSha256: z.string().min(1),
  suggestions: z.array(aiSuggestionSchema)
});
export type AiSuggestionBatch = z.infer<typeof aiSuggestionBatchSchema>;
