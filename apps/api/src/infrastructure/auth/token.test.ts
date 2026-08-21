import { describe, expect, it } from "vitest";
import { generateWorkerToken, hashToken, verifyToken } from "./token.js";

describe("worker token hashing", () => {
  it("generates tokens that are non-empty and unique", () => {
    const a = generateWorkerToken();
    const b = generateWorkerToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("verifies the correct token against its stored hash", async () => {
    const token = generateWorkerToken();
    const stored = await hashToken(token);
    await expect(verifyToken(token, stored)).resolves.toBe(true);
  });

  it("rejects an incorrect token", async () => {
    const stored = await hashToken(generateWorkerToken());
    await expect(verifyToken(generateWorkerToken(), stored)).resolves.toBe(false);
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    await expect(verifyToken("anything", "not-a-valid-hash")).resolves.toBe(false);
  });

  it("never stores the token in plaintext", async () => {
    const token = generateWorkerToken();
    const stored = await hashToken(token);
    expect(stored).not.toContain(token);
  });
});
