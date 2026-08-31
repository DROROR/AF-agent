import Anthropic from "@anthropic-ai/sdk";
import type { MappingEvidenceBundle } from "../../domain/mapping-evidence/types.js";
import type { AiSuggestionMetadata, AiSuggestionProvider, AiSuggestionResult } from "./ai-suggestion-provider.js";

const TOOL_NAME = "propose_mapping_suggestions";
const MAX_TOKENS = 8000;

/** Exported only so tests can assert on the real JSON Schema this provider sends Anthropic, rather than duplicating its text - see anthropic-suggestion-provider.test.ts. */
export const PROPOSAL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scenePlanId: { type: "string", minLength: 1 },
          // Guidance only, never enforcement (Anthropic strict mode has no
          // string-length keyword this codebase has proven it accepts,
          // other than the pre-existing minLength above on scenePlanId) -
          // the domain layer (aiSuggestionProposalSchema in @dyo/schemas)
          // is what actually rejects an empty string; this description
          // only steers the model away from producing one in the first
          // place.
          mappingId: { type: ["string", "null"], description: "Use null when there is no mapping id. Never an empty string." },
          // Anthropic's strict tool-schema validator (this tool is
          // registered with strict: true) rejects the ordinary JSON-Schema
          // "type: [X, 'null']" + "enum" combination for a nullable enum -
          // proven in production (400 invalid_request_error: "Enum value
          // 'image' does not match declared type ['string', 'null']"),
          // even though every enum value is a plain string satisfying that
          // type. anyOf (string-with-enum, or null) is the form its
          // validator accepts instead. Every other field/value this
          // produces or accepts is unchanged - still image/video/text/
          // logo/phone_screen/color/unknown/null, only the JSON-Schema
          // shape describing that set changed.
          suggestedClassification: {
            anyOf: [
              { type: "string", enum: ["image", "video", "text", "logo", "phone_screen", "color", "unknown"] },
              { type: "null" }
            ]
          },
          suggestedAssetId: { type: ["string", "null"], description: "Use null when no asset applies. Never an empty string." },
          suggestedText: { type: ["string", "null"] },
          suggestedAssetTimestamp: {
            type: ["number", "null"],
            description: "Non-negative timestamp in seconds when provided; otherwise null."
          },
          suggestedFinalDuration: {
            type: ["number", "null"],
            description: "Positive number of seconds when provided; otherwise null."
          },
          // Anthropic's strict tool-schema validator also rejects
          // `minimum`/`maximum` on a `number` type ("For 'number' type,
          // properties maximum, minimum are not supported") - found via
          // the real Anthropic acceptance smoke test for this same fix.
          // The [0,1] bound is still fully enforced independently at the
          // domain layer (aiSuggestionProposalSchema.confidence in
          // @dyo/schemas), which every provider's output already goes
          // through before anything is persisted - dropping this hint
          // only removes generation-time guidance to the model, never
          // the actual accepted-value validation. `description` is
          // guidance only, same caveat as every other description added
          // alongside it in this schema.
          confidence: { type: "number", description: "Number from 0 through 1." },
          reasoning: { type: ["string", "null"], description: "Use null if no rationale is given. Never an empty string." },
          evidenceRefs: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["FACT", "USER_INTENT", "AI_INFERENCE"] },
                summary: { type: "string", minLength: 1 }
              },
              required: ["kind", "summary"],
              additionalProperties: false
            }
          }
        },
        required: [
          "scenePlanId",
          "mappingId",
          "suggestedClassification",
          "suggestedAssetId",
          "suggestedText",
          "suggestedAssetTimestamp",
          "suggestedFinalDuration",
          "confidence",
          "reasoning",
          "evidenceRefs"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["proposals"],
  additionalProperties: false
} as const;

const SYSTEM_PROMPT = `You are a mapping-suggestion assistant for a deterministic After Effects automation system. You propose which real asset or text value should fill each unresolved template placeholder, for a human to review.

Hard rules, never violated:
- You ONLY ever call the ${TOOL_NAME} tool with structured proposals. You never write prose, JSX, shell commands, file paths, or render instructions anywhere in your response.
- Every suggestedAssetId you propose MUST be copied verbatim from the "candidateAssets" id field of the exact target you were given - never invent an id, never reuse an id from a different target's candidate list.
- Every proposal MUST include at least one evidenceRefs entry stating what real, given evidence it is based on (kind "FACT" for scene/manifest evidence you were given, "USER_INTENT" for a Work Map entry or user instruction you were given, "AI_INFERENCE" only for your own reasoning beyond what was directly given).
- Never invent a plausible-sounding content assignment just to fill every field. If you lack clear, direct evidence (a FACT you were given, or a USER_INTENT from Work Map/instructions) for what belongs in a target, set suggestedAssetId, suggestedText, and suggestedClassification to null, give a low confidence value (below 0.5), and explain in reasoning what evidence is missing - an honest "not enough evidence" proposal (the human sees this as "Needs review", the target keeps its original template content) is always better than a fabricated guess. This matters most for structural/decorative template elements - camera layers, masks, phone-frame artwork, shape/decorative layers, template control layers, alpha/matte helper layers, other template structural footage, and backgrounds - never propose replacing any of these without clear evidence or an explicit user instruction naming them by role.
- A human reviews every proposal before anything is applied; nothing you return is ever applied automatically.
- You have no ability to execute code, access the filesystem, control a real application, or take any action beyond returning this one structured tool call. Do not claim otherwise in evidenceRefs or reasoning text.`;

function summarizeBundle(bundle: MappingEvidenceBundle) {
  return {
    scenePlanId: bundle.scenePlanId,
    manifestCompositionId: bundle.manifestCompositionId,
    compositionName: bundle.compositionName,
    mappingId: bundle.mappingId,
    manifestPlaceholderId: bundle.manifestPlaceholderId,
    placeholderName: bundle.placeholderName,
    currentClassification: bundle.currentClassification,
    sceneEvidence: bundle.sceneEvidence,
    workMapEntry: bundle.workMapEntry,
    // Never storageKey/sha256/byteSize - opaque storage identifiers/integrity hashes the AI has no use for, matching "no Windows paths" in spirit.
    candidateAssets: bundle.candidateAssets.map((asset) => ({
      id: asset.id,
      originalFilename: asset.originalFilename,
      mediaKind: asset.mediaKind,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      label: asset.label,
      notes: asset.notes
    })),
    userInstructions: bundle.userInstructions,
    brandInputs: bundle.brandInputs
  };
}

export class AnthropicProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnthropicProviderError";
  }
}

/**
 * Real BYOK AI provider (multi-scene-accumulation-era Mapping Assistant
 * phase, BYOK section). Constructed per-request from ONE user's own
 * decrypted API key (see resolve-ai-suggestion-provider.ts) - never a
 * shared, app-wide credential. Uses Anthropic's strict tool use (forced
 * tool_choice + strict:true) rather than free-form JSON-in-prose: a
 * response is either a validated tool_use.input matching
 * PROPOSAL_INPUT_SCHEMA exactly, or the request fails - there is no
 * "Claude wrote JSON in a text block and we hoped it parses" path.
 *
 * `suggest()` returns the tool input as `unknown`, unvalidated by this
 * class itself - generate-mapping-suggestions.ts re-validates each
 * individual proposal against the SAME aiSuggestionProposalSchema
 * (@dyo/schemas) every other provider's output goes through (this
 * class's own doc comment on AiSuggestionProvider: "never trust a TS
 * type alone across a real process/network boundary") - one malformed
 * proposal is rejected on its own, never discarding its siblings. A
 * refused response (or one with no tool_use block at all) throws
 * AnthropicProviderError - a real, honest failure, never a fabricated
 * empty success.
 */
export class AnthropicSuggestionProvider implements AiSuggestionProvider {
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

  async suggest(bundles: MappingEvidenceBundle[]): Promise<AiSuggestionResult> {
    const userContent = JSON.stringify({ unresolvedTargets: bundles.map(summarizeBundle) });

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description: "Propose mapping suggestions for the given unresolved targets. This is the ONLY way to respond - never plain text.",
            strict: true,
            input_schema: PROPOSAL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema
          }
        ],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: userContent }]
      });
    } catch (error) {
      throw new AnthropicProviderError(
        error instanceof Anthropic.APIError ? `Anthropic API error (${error.status}): ${error.message}` : `Could not reach Anthropic: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (response.stop_reason === "refusal") {
      throw new AnthropicProviderError("Anthropic declined to respond to this request (safety refusal)");
    }

    // Non-sensitive completion metadata only - never the response content
    // itself. Captured regardless of what follows, so a real caller can
    // tell a genuine "nothing to propose" apart from a MAX_TOKENS
    // truncation (see this call's own stop_reason) without ever needing
    // to inspect the actual proposals/content to find out.
    const metadata: AiSuggestionMetadata = {
      stopReason: response.stop_reason,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null
    };

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME);
    if (!toolUse) {
      throw new AnthropicProviderError(`Anthropic did not return a ${TOOL_NAME} tool call (stop_reason: ${response.stop_reason})`);
    }

    return { proposals: toolUse.input, metadata };
  }
}
