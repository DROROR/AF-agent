import type { ProjectBrandInputs, WorkMapEntry } from "@dyo/schemas";

/** Non-sensitive completion metadata - same shape/purpose as AiSuggestionMetadata in mapping-assistant (see that file's own doc comment on why this exists: telling a genuine truncation apart from a normal empty response, without ever logging raw content). */
export interface AiWorkMapMetadata {
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiWorkMapDraftInput {
  /** The client's own free-text description of what they want - the only field here that is not already-structured project data. */
  instructions: string;
  compositions: Array<{ id: string; name: string }>;
  candidateAssets: Array<{ id: string; originalFilename: string; label: string | null; mediaKind: string }>;
  /** The project's current Work Map entries, if any - context only, never silently reused verbatim (the model still returns a complete new set). */
  existingEntries: WorkMapEntry[];
  brandInputs: ProjectBrandInputs | null;
  /** Real, persisted scene evidence compatible with the project's current manifest SHA, if any exists yet - most projects at this early stage have none, and that is expected, never required. */
  sceneEvidenceSummaries: Array<{ manifestCompositionId: string; compositionName: string }>;
}

/** `entries` is `unknown`, not a typed array - the caller (generate-ai-work-map-draft.ts) runtime-validates each individual entry before trusting it, exactly like AiSuggestionProvider's own proposals. */
export interface AiWorkMapDraftResult {
  entries: unknown;
  metadata: AiWorkMapMetadata;
}

export interface AiWorkMapProvider {
  isConfigured(): boolean;
  draftWorkMap(input: AiWorkMapDraftInput): Promise<AiWorkMapDraftResult>;
}

export class WorkMapDraftNotConfiguredError extends Error {
  constructor() {
    super("No AI provider is configured - this is a boundary/contract placeholder, not a broken implementation.");
    this.name = "WorkMapDraftNotConfiguredError";
  }
}

/** Honest stub - never fabricates a draft when no AI provider is connected. */
export class NotConfiguredAiWorkMapProvider implements AiWorkMapProvider {
  isConfigured(): boolean {
    return false;
  }

  async draftWorkMap(_input: AiWorkMapDraftInput): Promise<AiWorkMapDraftResult> {
    throw new WorkMapDraftNotConfiguredError();
  }
}
