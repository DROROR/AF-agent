import { z } from "zod";

/**
 * BYOK (Bring Your Own Key) AI provider connection (Settings -> AI
 * Provider). Anthropic only today - `AI_PROVIDER_NAMES` is a real enum
 * (not a boolean flag) specifically so adding OpenAI/Gemini later is an
 * enum-value + model-list addition, never a schema shape change.
 */
export const AI_PROVIDER_NAMES = ["ANTHROPIC"] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];
export const aiProviderNameSchema = z.enum(AI_PROVIDER_NAMES);

/** Selectable models for the "Model selection" field - the exact set apps/api's AnthropicSuggestionProvider is allowed to be constructed with. */
export const ANTHROPIC_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"] as const;
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];
export const anthropicModelSchema = z.enum(ANTHROPIC_MODELS);
export const DEFAULT_ANTHROPIC_MODEL: AnthropicModel = "claude-sonnet-5";

/**
 * Shared by both "Test Connection" (never persists) and "Save & Connect" /
 * "Replace Key" (persists only after a real successful call - see
 * connect-ai-provider.ts). The API key is never echoed back in any
 * response shape in this file - see aiProviderStatusSchema below, which
 * carries only `last4`.
 */
export const connectAiProviderRequestSchema = z
  .object({
    provider: aiProviderNameSchema,
    apiKey: z.string().min(20, "This does not look like a real API key").max(500),
    model: anthropicModelSchema
  })
  .strict();
export type ConnectAiProviderRequest = z.infer<typeof connectAiProviderRequestSchema>;

export const testAiProviderConnectionResponseSchema = z
  .object({
    ok: z.boolean(),
    reason: z.string().nullable()
  })
  .strict();
export type TestAiProviderConnectionResponse = z.infer<typeof testAiProviderConnectionResponseSchema>;

/**
 * Browser-facing connection status - deliberately carries NO key material
 * at all, not even encrypted (never sent to the browser - see
 * schema.ts's own doc comment on user_ai_providers.encryptedApiKey).
 * `last4` is the only fragment of the real key ever exposed.
 */
export const aiProviderStatusSchema = z
  .object({
    connected: z.boolean(),
    provider: aiProviderNameSchema.nullable(),
    model: z.string().nullable(),
    last4: z.string().nullable(),
    lastVerifiedAt: z.string().datetime().nullable()
  })
  .strict();
export type AiProviderStatus = z.infer<typeof aiProviderStatusSchema>;

export const aiProviderStatusResponseSchema = z.object({ status: aiProviderStatusSchema }).strict();
export type AiProviderStatusResponse = z.infer<typeof aiProviderStatusResponseSchema>;
