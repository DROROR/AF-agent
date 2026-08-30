import type { MappingEvidenceBundle } from "../../domain/mapping-evidence/types.js";

/**
 * Non-sensitive completion metadata from a real provider call - never the
 * raw response content, prompt, or credentials. Added 2026-08-30 so a
 * real production case (a genuine ~62s Anthropic call that produced zero
 * usable proposals for 106 eligible targets) can be told apart from a
 * MAX_TOKENS truncation without ever calling the provider again just to
 * find out - the next real request logs this instead. `null` on any field
 * means the underlying value was not available (e.g. the provider is not
 * configured, or a real response omitted usage data) - never fabricated.
 */
export interface AiSuggestionMetadata {
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** `proposals` is exactly the same unvalidated `unknown` this interface always returned - only wrapped alongside metadata now. Existing consumers that only care about proposals are unaffected in shape, just reached via `.proposals`. */
export interface AiSuggestionResult {
  proposals: unknown;
  metadata: AiSuggestionMetadata;
}

/**
 * The seam for a future AI mapping-suggestion provider
 * (mapping-assistant phase section 5). Superseded/widened from the
 * original Phase 4 draft (which only took a bare TemplateManifest) -
 * nothing called that version in any real endpoint either, so this is an
 * evolution of the one existing provider abstraction, not a second,
 * parallel seam. Input is strict, structured, already-assembled evidence
 * (never a raw natural-language prompt string built anywhere in domain/
 * application code - section 5: "Provider input must be strict structured
 * data"); any real implementation is responsible for its own safe prompt
 * construction internally, entirely behind this interface, and must
 * return output whose individual proposals each validate against
 * aiSuggestionProposalSchema (@dyo/schemas) - a proposal that fails that
 * validation is rejected on its own, never partially trusted, and never
 * takes down the rest of a real batch alongside it. A suggestion returned
 * here can only
 * ever become a real mapping via the same typed MAP_ASSET/SET_TEXT/...
 * execution-plan edit operations a human uses, after an explicit human
 * Accept (see accept-mapping-suggestion.ts) - never a separate,
 * less-validated write path, and never permission to execute AE, call a
 * shell, generate JSX, or select an asset from another project.
 *
 * `proposals` is `unknown`, not a typed array - the caller (generate-
 * mapping-suggestions.ts) runtime-validates each individual proposal
 * against aiSuggestionProposalSchema before trusting a single field of
 * it, so one malformed proposal never discards the rest of a real batch.
 * A provider's own compile-time return type is never sufficient proof by
 * itself that a real implementation actually returned well-formed data
 * (same "never trust a TS type alone across a real process/network
 * boundary" rule this codebase already applies to job/worker results).
 */
export interface AiSuggestionProvider {
  /** Cheap, synchronous, side-effect-free - lets a caller (e.g. list-mapping-suggestions.ts) report whether AI is configured without ever invoking suggest(). */
  isConfigured(): boolean;
  suggest(bundles: MappingEvidenceBundle[]): Promise<AiSuggestionResult>;
}

export class SuggestionsNotConfiguredError extends Error {
  constructor() {
    super("No AI suggestion provider is configured - this is a boundary/contract placeholder, not a broken implementation.");
    this.name = "SuggestionsNotConfiguredError";
  }
}

/**
 * Honest stub - mirrors NotAvailableTemplateInspector/AfterEffectsRenderer's
 * "never fabricate, always fail loudly with a clear reason" pattern.
 * generate-mapping-suggestions.ts catches SuggestionsNotConfiguredError
 * specifically and continues with deterministic-only results (section 5:
 * "If provider is not configured: system remains usable, deterministic
 * suggestions still work, UI reports AI unavailable/not configured") -
 * this is never surfaced to the caller as a request failure.
 */
export class NotConfiguredAiSuggestionProvider implements AiSuggestionProvider {
  isConfigured(): boolean {
    return false;
  }

  async suggest(_bundles: MappingEvidenceBundle[]): Promise<AiSuggestionResult> {
    throw new SuggestionsNotConfiguredError();
  }
}
