import { timingSafeEqual } from "node:crypto";

/**
 * Gate on POST /workers/register. A single shared secret is enough for the
 * Phase 1 MVP (one client); every worker still gets its own unique ID and
 * long-lived token once registered. If onboarding grows beyond one client,
 * this can become a per-client pairing token without changing callers.
 */
export function verifyPairingSecret(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
