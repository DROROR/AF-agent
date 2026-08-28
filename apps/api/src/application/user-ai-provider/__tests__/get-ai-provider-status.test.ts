import { describe, expect, it } from "vitest";
import { InMemoryUserAiProviderRepository } from "../test-support/in-memory-user-ai-provider-repository.js";
import { getAiProviderStatus } from "../get-ai-provider-status.js";

const NOW = new Date("2026-08-28T00:00:00.000Z");

describe("getAiProviderStatus", () => {
  it("reports not connected for a user with no stored connection", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    expect(await getAiProviderStatus({ userAiProviderRepository: repo }, "user-1")).toEqual({
      connected: false,
      provider: null,
      model: null,
      last4: null,
      lastVerifiedAt: null
    });
  });

  it("returns only masked status fields for a connected user - never the encrypted key", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    await repo.upsert({ id: "conn-1", userId: "user-1", provider: "ANTHROPIC", encryptedApiKey: "iv:tag:cipher", last4: "WXYZ", model: "claude-sonnet-5" }, NOW);

    const status = await getAiProviderStatus({ userAiProviderRepository: repo }, "user-1");
    expect(status).toEqual({
      connected: true,
      provider: "ANTHROPIC",
      model: "claude-sonnet-5",
      last4: "WXYZ",
      lastVerifiedAt: NOW.toISOString()
    });
    expect(Object.keys(status)).not.toContain("encryptedApiKey");
  });

  it("never returns another user's connection status", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    await repo.upsert({ id: "conn-1", userId: "user-1", provider: "ANTHROPIC", encryptedApiKey: "iv:tag:cipher", last4: "WXYZ", model: "claude-sonnet-5" }, NOW);

    expect(await getAiProviderStatus({ userAiProviderRepository: repo }, "user-2")).toEqual({
      connected: false,
      provider: null,
      model: null,
      last4: null,
      lastVerifiedAt: null
    });
  });
});
