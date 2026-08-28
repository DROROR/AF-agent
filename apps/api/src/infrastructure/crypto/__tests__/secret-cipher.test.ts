import { describe, expect, it } from "vitest";
import { EncryptionNotConfiguredError, SecretDecryptionError, decryptSecret, encryptSecret, last4 } from "../secret-cipher.js";

const MASTER_KEY = "test-master-key-at-least-16-chars";

describe("secret-cipher", () => {
  it("round-trips a plaintext through encrypt/decrypt under the same master key", () => {
    const encrypted = encryptSecret("sk-ant-super-secret-value", MASTER_KEY);
    expect(decryptSecret(encrypted, MASTER_KEY)).toBe("sk-ant-super-secret-value");
  });

  it("never stores the plaintext inside the encrypted value", () => {
    const encrypted = encryptSecret("sk-ant-super-secret-value", MASTER_KEY);
    expect(encrypted).not.toContain("sk-ant-super-secret-value");
  });

  it("produces a different ciphertext each time (random IV) even for the same plaintext", () => {
    const first = encryptSecret("same-value", MASTER_KEY);
    const second = encryptSecret("same-value", MASTER_KEY);
    expect(first).not.toBe(second);
    expect(decryptSecret(first, MASTER_KEY)).toBe("same-value");
    expect(decryptSecret(second, MASTER_KEY)).toBe("same-value");
  });

  it("fails closed when decrypting under the wrong master key", () => {
    const encrypted = encryptSecret("sk-ant-super-secret-value", MASTER_KEY);
    expect(() => decryptSecret(encrypted, "a-completely-different-key")).toThrow(SecretDecryptionError);
  });

  it("fails closed on a tampered ciphertext (GCM auth tag mismatch)", () => {
    const encrypted = encryptSecret("sk-ant-super-secret-value", MASTER_KEY);
    const parts = encrypted.split(":");
    const tamperedCiphertext = (parts[2] ?? "").replace(/^[0-9a-f]/, (c) => (c === "0" ? "1" : "0"));
    const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;
    expect(() => decryptSecret(tampered, MASTER_KEY)).toThrow(SecretDecryptionError);
  });

  it("fails closed on a malformed stored value", () => {
    expect(() => decryptSecret("not-the-right-shape", MASTER_KEY)).toThrow(SecretDecryptionError);
  });

  it("throws EncryptionNotConfiguredError when the master key is empty, never silently proceeding", () => {
    expect(() => encryptSecret("value", "")).toThrow(EncryptionNotConfiguredError);
    expect(() => decryptSecret("a:b:c", "")).toThrow(EncryptionNotConfiguredError);
  });

  it("last4 exposes only the final 4 characters", () => {
    expect(last4("sk-ant-api03-abcdWXYZ")).toBe("WXYZ");
  });
});
