import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Reversible at-rest encryption for a user's own BYOK AI provider API key
 * (schema.ts's own doc comment on user_ai_providers.encryptedApiKey) -
 * deliberately NOT the same family as password.ts/token.ts's one-way
 * scrypt hashing: those only ever need equality-checking, this needs the
 * real plaintext back so the server can actually call Anthropic with it.
 * AES-256-GCM: authenticated encryption (a tampered/corrupted ciphertext
 * fails to decrypt rather than silently returning garbage bytes).
 *
 * The master key comes from CREDENTIALS_ENCRYPTION_KEY (env.ts) - an
 * operator-supplied secret of any length, hashed here to a fixed 32-byte
 * AES-256 key via SHA-256 so the env var itself is never required to be
 * exactly N hex characters (a real footgun for whoever sets it).
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super("CREDENTIALS_ENCRYPTION_KEY is not configured on this server - BYOK provider connections cannot be stored or read.");
    this.name = "EncryptionNotConfiguredError";
  }
}

function deriveKey(masterSecret: string): Buffer {
  return createHash("sha256").update(masterSecret, "utf8").digest();
}

/** Returns `iv:authTag:ciphertext`, all hex-encoded - never logged, never returned to the browser (see routes/user-ai-provider.ts's own doc comment). */
export function encryptSecret(plaintext: string, masterSecret: string): string {
  if (!masterSecret) {
    throw new EncryptionNotConfiguredError();
  }
  const key = deriveKey(masterSecret);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export class SecretDecryptionError extends Error {
  constructor(reason: string) {
    super(`Could not decrypt stored provider credentials: ${reason}`);
    this.name = "SecretDecryptionError";
  }
}

/** Fails closed (never returns a partial/garbage plaintext) if the ciphertext is malformed, was encrypted under a different master key, or has been tampered with - GCM's own auth tag check catches all three. */
export function decryptSecret(encrypted: string, masterSecret: string): string {
  if (!masterSecret) {
    throw new EncryptionNotConfiguredError();
  }
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new SecretDecryptionError("malformed stored value");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const key = deriveKey(masterSecret);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (error) {
    throw new SecretDecryptionError(error instanceof Error ? error.message : String(error));
  }
}

/** Never the full key - the last 4 characters only, for masked display (e.g. "sk-ant-...wXyZ"). */
export function last4(secret: string): string {
  return secret.slice(-4);
}
