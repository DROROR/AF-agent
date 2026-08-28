import { describe, expect, it } from "vitest";
import { AiProviderConnectionFailedError } from "../../../errors/app-error.js";
import { InMemoryUserAiProviderRepository } from "../test-support/in-memory-user-ai-provider-repository.js";
import { connectAiProvider } from "../connect-ai-provider.js";
import { decryptSecret } from "../../../infrastructure/crypto/secret-cipher.js";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const MASTER_KEY = "test-master-key-at-least-16-chars";

function deps(overrides: Partial<Parameters<typeof connectAiProvider>[0]> = {}) {
  return {
    userAiProviderRepository: new InMemoryUserAiProviderRepository(),
    credentialsEncryptionKey: MASTER_KEY,
    now: () => NOW,
    testConnection: async () => ({ ok: true as const }),
    ...overrides
  };
}

describe("connectAiProvider", () => {
  it("persists an encrypted connection and returns a masked status - never the raw key", async () => {
    const d = deps();
    const status = await connectAiProvider(d, "user-1", { provider: "ANTHROPIC", apiKey: "sk-ant-abcd1234WXYZ", model: "claude-sonnet-5" });

    expect(status).toEqual({
      connected: true,
      provider: "ANTHROPIC",
      model: "claude-sonnet-5",
      last4: "WXYZ",
      lastVerifiedAt: NOW.toISOString()
    });
    expect(JSON.stringify(status)).not.toContain("sk-ant-abcd1234WXYZ");

    const stored = await d.userAiProviderRepository.findByUserId("user-1");
    expect(stored?.encryptedApiKey).not.toContain("sk-ant-abcd1234WXYZ");
    expect(decryptSecret(stored!.encryptedApiKey, MASTER_KEY)).toBe("sk-ant-abcd1234WXYZ");
  });

  it("never persists anything when the real connection test fails", async () => {
    const d = deps({ testConnection: async () => ({ ok: false as const, reason: "Invalid API key" }) });

    await expect(connectAiProvider(d, "user-1", { provider: "ANTHROPIC", apiKey: "bad-key", model: "claude-sonnet-5" })).rejects.toThrow(
      AiProviderConnectionFailedError
    );

    expect(await d.userAiProviderRepository.findByUserId("user-1")).toBeNull();
  });

  it("replaces an existing connection for the same user (Save & Connect / Replace Key are the same action)", async () => {
    const d = deps();
    await connectAiProvider(d, "user-1", { provider: "ANTHROPIC", apiKey: "sk-ant-first-keyAAAA", model: "claude-sonnet-5" });
    await connectAiProvider(d, "user-1", { provider: "ANTHROPIC", apiKey: "sk-ant-second-keyBBBB", model: "claude-opus-5" });

    const stored = await d.userAiProviderRepository.findByUserId("user-1");
    expect(stored?.model).toBe("claude-opus-5");
    expect(decryptSecret(stored!.encryptedApiKey, MASTER_KEY)).toBe("sk-ant-second-keyBBBB");
  });

  it("scopes storage to the given userId only - one user's connect never touches another's row", async () => {
    const d = deps();
    await connectAiProvider(d, "user-1", { provider: "ANTHROPIC", apiKey: "sk-ant-user-oneAAAA", model: "claude-sonnet-5" });
    await connectAiProvider(d, "user-2", { provider: "ANTHROPIC", apiKey: "sk-ant-user-twoBBBB", model: "claude-sonnet-5" });

    const userOne = await d.userAiProviderRepository.findByUserId("user-1");
    const userTwo = await d.userAiProviderRepository.findByUserId("user-2");
    expect(decryptSecret(userOne!.encryptedApiKey, MASTER_KEY)).toBe("sk-ant-user-oneAAAA");
    expect(decryptSecret(userTwo!.encryptedApiKey, MASTER_KEY)).toBe("sk-ant-user-twoBBBB");
  });
});
