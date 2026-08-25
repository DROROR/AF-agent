import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Deliberately parallel to token.ts's worker-token hashing, not shared with
 * it - see password.ts's comment for why these stay independent.
 */
const scryptAsync = promisify(scrypt) as (
  secret: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;
const KEY_LENGTH = 64;

export interface GeneratedSessionToken {
  /** Primary key of the sessions row - looked up directly, never scanned for. */
  sessionId: string;
  /** The random secret half, given to the client and hashed before storage. */
  secret: string;
  /** `${sessionId}.${secret}` - the single opaque value stored in the browser's cookie. */
  cookieValue: string;
}

export function generateSessionToken(): GeneratedSessionToken {
  const sessionId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  return { sessionId, secret, cookieValue: `${sessionId}.${secret}` };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Splits a cookie value back into its lookup id and secret. Returns null
 * for any malformed input, including a sessionId that isn't UUID-shaped -
 * sessionId is attacker-controlled (it's read straight from the cookie
 * before any lookup) and the sessions table's id column is a Postgres
 * `uuid`, which throws on invalid input rather than just finding no row.
 * Rejecting the shape here keeps a garbage/tampered cookie a clean 401
 * instead of a 500.
 */
export function parseSessionCookieValue(
  cookieValue: string
): { sessionId: string; secret: string } | null {
  const separatorIndex = cookieValue.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === cookieValue.length - 1) {
    return null;
  }
  const sessionId = cookieValue.slice(0, separatorIndex);
  const secret = cookieValue.slice(separatorIndex + 1);
  if (!UUID_PATTERN.test(sessionId)) {
    return null;
  }
  return { sessionId, secret };
}

export async function hashSessionSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(secret, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifySessionSecret(secret: string, storedHash: string): Promise<boolean> {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  const derivedKey = await scryptAsync(secret, salt, KEY_LENGTH);
  if (derivedKey.length !== expectedKey.length) {
    return false;
  }
  return timingSafeEqual(derivedKey, expectedKey);
}
