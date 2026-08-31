import Anthropic from "@anthropic-ai/sdk";
import type { AiWorkMapDraftInput, AiWorkMapDraftResult, AiWorkMapMetadata, AiWorkMapProvider } from "./ai-work-map-provider.js";

const TOOL_NAME = "propose_work_map_entries";
const MAX_TOKENS = 8000;

/**
 * JSON Schema for the real Anthropic tool call - deliberately mirrors the
 * lessons already paid for in anthropic-suggestion-provider.ts (see that
 * file's own doc comments, 2026-08-30): never `minimum`/`maximum` on a
 * `number` type, never a bare `type: [X, "null"]` + `enum` combination -
 * both proven to make Anthropic's strict tool-schema validator reject the
 * whole tool with a 400. This schema uses neither pattern from the start.
 * `description` fields are guidance only, never enforcement - the domain
 * layer (updateWorkMapRequestSchema in @dyo/schemas, applied per-entry in
 * generate-ai-work-map-draft.ts) is what actually validates output.
 */
export const WORK_MAP_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceCompositionId: {
            type: ["string", "null"],
            description: "Copy verbatim from the real compositions list you were given. Null only if truly no matching scene exists."
          },
          sourceReference: { type: ["string", "null"], description: "A short human label for this row, e.g. the scene's own name. Never an empty string." },
          desiredAssetId: {
            type: ["string", "null"],
            description: "Copy verbatim from the real candidateAssets id field. Use null when no asset clearly applies - never guess. Never an empty string."
          },
          desiredText: { type: ["string", "null"], description: "Use null if no on-screen text is wanted here. Never an empty string." },
          assetTimestampSeconds: { type: ["number", "null"], description: "Non-negative timestamp in seconds when provided; otherwise null." },
          desiredDurationSeconds: { type: ["number", "null"], description: "Positive number of seconds when provided; otherwise null." },
          instructions: { type: ["string", "null"], description: "Any extra layout/branding notes for this scene. Null if none. Never an empty string." }
        },
        required: ["sourceCompositionId", "sourceReference", "desiredAssetId", "desiredText", "assetTimestampSeconds", "desiredDurationSeconds", "instructions"],
        additionalProperties: false
      }
    }
  },
  required: ["entries"],
  additionalProperties: false
} as const;

const SYSTEM_PROMPT = `You are a video-planning assistant for a deterministic After Effects automation system. A real client described what they want, in their own words. You translate that into a structured Work Map: one entry per real template scene (composition), naming which real asset (if any) and text (if any) the client wants there. A human reviews and can edit every entry before anything is applied - nothing you return is ever applied automatically.

Hard rules, never violated:
- You ONLY ever call the ${TOOL_NAME} tool with structured entries. You never write prose, JSX, shell commands, file paths, or render instructions anywhere in your response.
- Every sourceCompositionId you propose MUST be copied verbatim from the "compositions" list you were given - never invent one.
- Every desiredAssetId you propose MUST be copied verbatim from the "candidateAssets" id field you were given - never invent one, never reuse an id for content it clearly does not match.
- If the client's instructions do not clearly indicate what belongs in a scene, leave desiredAssetId and desiredText as null for that scene rather than guessing - a null/empty entry is far better than a wrong one, and the client can always fill it in themselves. This matters most for structural template elements (camera layers, masks, phone-frame artwork, decorative shapes, backgrounds) - never assign real content to these unless the client's own instructions clearly call for it.
- You have no ability to execute code, access the filesystem, control a real application, or take any action beyond returning this one structured tool call. Do not claim otherwise in any field.`;

function summarizeInput(input: AiWorkMapDraftInput) {
  return {
    instructions: input.instructions,
    compositions: input.compositions,
    candidateAssets: input.candidateAssets,
    existingEntries: input.existingEntries.map((entry) => ({
      sourceCompositionId: entry.sourceCompositionId,
      sourceReference: entry.sourceReference,
      desiredAssetId: entry.desiredAssetId,
      desiredText: entry.desiredText,
      assetTimestampSeconds: entry.assetTimestampSeconds,
      desiredDurationSeconds: entry.desiredDurationSeconds,
      instructions: entry.instructions
    })),
    brandInputs: input.brandInputs,
    sceneEvidenceSummaries: input.sceneEvidenceSummaries
  };
}

export class AiWorkMapDraftProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiWorkMapDraftProviderError";
  }
}

/**
 * Real BYOK AI provider for the "Tell AI what you want" Work Map draft
 * feature - constructed per-request from ONE user's own decrypted API key
 * (see resolve-ai-work-map-provider.ts), never a shared, app-wide
 * credential. Uses Anthropic's strict tool use, same as
 * AnthropicSuggestionProvider - a response is either a validated
 * tool_use.input, or the request fails; there is no free-form
 * JSON-in-prose fallback.
 */
export class AnthropicWorkMapDraftProvider implements AiWorkMapProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  isConfigured(): boolean {
    return true;
  }

  async draftWorkMap(input: AiWorkMapDraftInput): Promise<AiWorkMapDraftResult> {
    const userContent = JSON.stringify(summarizeInput(input));

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description: "Propose a Work Map (one entry per scene) from the client's own instructions. This is the ONLY way to respond - never plain text.",
            strict: true,
            input_schema: WORK_MAP_DRAFT_SCHEMA as unknown as Anthropic.Tool.InputSchema
          }
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: userContent }]
      });
    } catch (error) {
      throw new AiWorkMapDraftProviderError(
        error instanceof Anthropic.APIError ? `Anthropic API error (${error.status}): ${error.message}` : `Could not reach Anthropic: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (response.stop_reason === "refusal") {
      throw new AiWorkMapDraftProviderError("Anthropic declined to respond to this request (safety refusal)");
    }

    const metadata: AiWorkMapMetadata = {
      stopReason: response.stop_reason,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null
    };

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME);
    if (!toolUse) {
      throw new AiWorkMapDraftProviderError(`Anthropic did not return a ${TOOL_NAME} tool call (stop_reason: ${response.stop_reason})`);
    }

    return { entries: toolUse.input, metadata };
  }
}
