import { describe, expect, it } from "vitest";
import { InMemoryUserAiProviderRepository } from "../../user-ai-provider/test-support/in-memory-user-ai-provider-repository.js";
import { encryptSecret } from "../../../infrastructure/crypto/secret-cipher.js";
import { resolveAiSuggestionProviderForUser } from "../resolve-ai-suggestion-provider.js";
import { NotConfiguredAiSuggestionProvider } from "../ai-suggestion-provider.js";
import { AnthropicSuggestionProvider } from "../anthropic-suggestion-provider.js";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const MASTER_KEY = "test-master-key-at-least-16-chars";

describe("resolveAiSuggestionProviderForUser", () => {
  it("returns the honest not-configured stub when the user has no connection", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    const provider = await resolveAiSuggestionProviderForUser({ userAiProviderRepository: repo, credentialsEncryptionKey: MASTER_KEY }, "user-1");
    expect(provider).toBeInstanceOf(NotConfiguredAiSuggestionProvider);
    expect(provider.isConfigured()).toBe(false);
  });

  it("resolves a real per-user AnthropicSuggestionProvider from the user's own decrypted key", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    await repo.upsert(
      { id: "conn-1", userId: "user-1", provider: "ANTHROPIC", encryptedApiKey: encryptSecret("sk-ant-real-key", MASTER_KEY), last4: "-key", model: "claude-sonnet-5" },
      NOW
    );

    const provider = await resolveAiSuggestionProviderForUser({ userAiProviderRepository: repo, credentialsEncryptionKey: MASTER_KEY }, "user-1");
    expect(provider).toBeInstanceOf(AnthropicSuggestionProvider);
    expect(provider.isConfigured()).toBe(true);
  });

  it("never resolves a different user's connection", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    await repo.upsert(
      { id: "conn-1", userId: "user-1", provider: "ANTHROPIC", encryptedApiKey: encryptSecret("sk-ant-real-key", MASTER_KEY), last4: "-key", model: "claude-sonnet-5" },
      NOW
    );

    const provider = await resolveAiSuggestionProviderForUser({ userAiProviderRepository: repo, credentialsEncryptionKey: MASTER_KEY }, "user-2");
    expect(provider).toBeInstanceOf(NotConfiguredAiSuggestionProvider);
  });
});
