import { describe, expect, it } from "vitest";
import { InMemoryUserAiProviderRepository } from "../test-support/in-memory-user-ai-provider-repository.js";
import { disconnectAiProvider } from "../disconnect-ai-provider.js";

const NOW = new Date("2026-08-28T00:00:00.000Z");

describe("disconnectAiProvider", () => {
  it("deletes the stored connection outright", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    await repo.upsert({ id: "conn-1", userId: "user-1", provider: "ANTHROPIC", encryptedApiKey: "iv:tag:cipher", last4: "WXYZ", model: "claude-sonnet-5" }, NOW);

    await disconnectAiProvider({ userAiProviderRepository: repo }, "user-1");

    expect(await repo.findByUserId("user-1")).toBeNull();
  });

  it("is idempotent for a user with no connection", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    await expect(disconnectAiProvider({ userAiProviderRepository: repo }, "user-1")).resolves.toBeUndefined();
  });

  it("never deletes another user's connection", async () => {
    const repo = new InMemoryUserAiProviderRepository();
    await repo.upsert({ id: "conn-1", userId: "user-1", provider: "ANTHROPIC", encryptedApiKey: "iv:tag:cipher", last4: "AAAA", model: "claude-sonnet-5" }, NOW);
    await repo.upsert({ id: "conn-2", userId: "user-2", provider: "ANTHROPIC", encryptedApiKey: "iv:tag:cipher", last4: "BBBB", model: "claude-sonnet-5" }, NOW);

    await disconnectAiProvider({ userAiProviderRepository: repo }, "user-1");

    expect(await repo.findByUserId("user-1")).toBeNull();
    expect(await repo.findByUserId("user-2")).not.toBeNull();
  });
});
