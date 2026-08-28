import Anthropic from "@anthropic-ai/sdk";

export type TestAnthropicConnectionResult = { ok: true } | { ok: false; reason: string };

/**
 * "Test Connection" (Settings -> AI Provider) - the ONE real, cheap call
 * that proves an operator-supplied API key + model actually work before
 * anything is ever persisted. Never writes anything; a 1-token request is
 * the smallest real proof of a working key this project's own "never
 * fabricate a success" rule allows (a bare "does this string look like a
 * key" check would not actually prove the key works).
 */
export async function testAnthropicConnection(apiKey: string, model: string): Promise<TestAnthropicConnectionResult> {
  const client = new Anthropic({ apiKey });
  try {
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }]
    });
    return { ok: true };
  } catch (error) {
    // Ordered most-specific-first: PermissionDeniedError/NotFoundError both
    // extend APIError, so they must be checked before the generic APIError
    // fallback - otherwise a real "this key can't use this model" response
    // would be misreported as a generic API error instead of the specific,
    // actionable reason a human can actually act on.
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, reason: "Invalid API key" };
    }
    if (error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.NotFoundError) {
      return { ok: false, reason: "Model not available for this API key" };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: "Anthropic API rate limit reached - try again shortly" };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { ok: false, reason: "Network error - could not reach Anthropic" };
    }
    if (error instanceof Anthropic.InternalServerError) {
      return { ok: false, reason: "Anthropic API unavailable" };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: `Anthropic API error (${error.status}): ${error.message}` };
    }
    return { ok: false, reason: error instanceof Error ? error.message : "Anthropic API unavailable" };
  }
}
