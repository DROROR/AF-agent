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
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, reason: "Invalid API key" };
    }
    if (error instanceof Anthropic.NotFoundError) {
      return { ok: false, reason: `Model "${model}" was not found` };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: `Anthropic API error (${error.status}): ${error.message}` };
    }
    return { ok: false, reason: error instanceof Error ? error.message : "Could not reach Anthropic" };
  }
}
