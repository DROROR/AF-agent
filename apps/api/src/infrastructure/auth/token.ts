import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/** Bearer token handed to a worker exactly once, at registration time. */
export function generateWorkerToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Worker tokens are never stored in plaintext (docs/engineering/SECURITY.md).
 * Stored as `salt:hash`, both hex-encoded, using scrypt (Node built-in - no
 * extra dependency needed for something this well covered by the standard
 * library).
 */
export async function hashToken(token: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(token, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyToken(token: string, storedHash: string): Promise<boolean> {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  const derivedKey = (await scryptAsync(token, salt, KEY_LENGTH)) as Buffer;
  if (derivedKey.length !== expectedKey.length) {
    return false;
  }
  return timingSafeEqual(derivedKey, expectedKey);
}
