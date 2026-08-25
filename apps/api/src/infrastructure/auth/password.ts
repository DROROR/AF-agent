import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Deliberately parallel to infrastructure/auth/token.ts's worker-token
 * hashing rather than sharing code with it - dashboard user auth and
 * Windows worker token auth are separate systems (CLAUDE.md) and must stay
 * independently changeable. scrypt is Node's own built-in, salted,
 * memory-hard KDF - no extra native dependency needed for this (see
 * docs/engineering/SECURITY.md: "avoid unnecessary packages").
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;
const KEY_LENGTH = 64;

/** Stored as `salt:hash`, both hex-encoded. Never store a plaintext password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  if (derivedKey.length !== expectedKey.length) {
    return false;
  }
  return timingSafeEqual(derivedKey, expectedKey);
}

/**
 * A hash of a fixed, never-used password, computed once and memoized. Used
 * by the login flow to run a real verifyPassword comparison even when no
 * matching account exists, so "email not found" and "wrong password" take
 * statistically the same time and a response never leaks which case
 * occurred (see application/auth/log-in.ts).
 */
let dummyPasswordHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyPasswordHash;
}
