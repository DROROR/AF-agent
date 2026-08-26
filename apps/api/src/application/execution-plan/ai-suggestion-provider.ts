import type { AiSuggestionBatch, TemplateManifest } from "@dyo/schemas";

/**
 * The seam for a future AI mapping-suggestion provider (Phase 4 section
 * 11). No implementation is wired into any real endpoint yet - nothing
 * in Phase 4 calls this. Output is always the strict aiSuggestionBatchSchema
 * contract (packages/schemas/src/ai-suggestion.ts): a suggestion can only
 * ever become a real mapping via the same typed MAP_ASSET/SET_TEXT/...
 * edit operations a human uses, with mappingSource recorded as
 * "AI_SUGGESTION" - never a separate, less-validated write path, and
 * never arbitrary JSX/shell/worker commands.
 */
export interface AiSuggestionProvider {
  suggest(manifest: TemplateManifest): Promise<AiSuggestionBatch>;
}

export class SuggestionsNotConfiguredError extends Error {
  constructor() {
    super("No AI suggestion provider is configured - this is a boundary/contract placeholder, not a broken implementation.");
    this.name = "SuggestionsNotConfiguredError";
  }
}

/**
 * Honest stub - mirrors NotAvailableTemplateInspector/AfterEffectsRenderer's
 * "never fabricate, always fail loudly with a clear reason" pattern. Never
 * called by any Phase 4 route; kept only as the reference implementation
 * of the interface until an approved AI provider abstraction exists.
 */
export class NotConfiguredAiSuggestionProvider implements AiSuggestionProvider {
  async suggest(_manifest: TemplateManifest): Promise<AiSuggestionBatch> {
    throw new SuggestionsNotConfiguredError();
  }
}
