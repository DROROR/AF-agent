/**
 * Secret redaction for every byte a diagnostic returns.
 *
 * This runs on the WORKER, before anything leaves the machine - never only
 * in the API or the dashboard. A diagnostic's whole purpose is to ship raw
 * machine evidence (log lines, command lines, environment-shaped strings) to
 * somewhere it can be read, and raw machine evidence is exactly where
 * credentials leak from. docs/engineering/SECURITY.md's "secrets are never
 * logged or returned" applies with full force here.
 *
 * DELIBERATELY CONSERVATIVE: it is always correct to redact something that
 * turned out to be harmless, and never correct to emit something that turned
 * out to be a token. Where the two conflict, this over-redacts.
 */

const REDACTED = "[REDACTED]";

/**
 * Key names whose VALUE is always a secret, matched case-insensitively in
 * `key=value`, `key: value`, `"key":"value"` and `--key value` shapes. Kept
 * broad on purpose - "pass" catches password/passphrase/passwd.
 */
/**
 * The separator deliberately allows an optional CLOSING QUOTE before the
 * `:` so that JSON - the format worker.log is actually written in - is
 * matched. Without it, `"workerToken":"..."` did not match at all: the key
 * name is followed by `"` before the colon. That hole went unnoticed only
 * because the shape-based fallback below happened to catch long opaque runs
 * anyway, which is not a guarantee (a short or digest-shaped secret would
 * have sailed straight through). Found 2026-09-12 while fixing the git-SHA
 * false positive, by the test that then failed.
 */
const SECRET_KEY_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:pass|secret|token|apikey|api_key|credential|authorization|auth|bearer|cookie|session|private_key|privatekey|signature|dsn|connection_?string)[A-Za-z0-9_.-]*)\b("?\s*[:=]\s*|\s+)("[^"]*"|'[^']*'|\S+)/gi;

/**
 * `Bearer <token>` and friends. This MUST run before SECRET_KEY_PATTERN:
 * against "authorization: Bearer abc123...", the key pattern happily treats
 * the word "Bearer" as the value and redacts that, leaving the actual
 * credential in place - a hole found by this module's own test, not in
 * review. The scheme word is kept because it is useful, non-secret context.
 */
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Digest|Token)\s+([A-Za-z0-9._~+/=-]{8,})/gi;

/** Anything that looks like a URL carrying inline credentials: scheme://user:pass@host */
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi;

/** JWT-shaped strings, which carry their own payload and must never be echoed even if their key name was unrecognized. */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** A long opaque hex/base64ish run - the shape of a raw worker token. 32+ chars avoids eating SHA-256 file hashes we WANT to see... which are exactly 64 hex, so those are allowed back below. */
const OPAQUE_SECRET_PATTERN = /\b[A-Za-z0-9_-]{40,}\b/g;

/**
 * Bare hex digests are real, useful, NON-SECRET evidence this project
 * depends on, and must survive redaction:
 *   - 64 hex = SHA-256 (source .aep integrity, release payload hashes)
 *   - 40 hex = a git commit SHA (which build is actually running)
 *
 * REAL 2026-09-12 FALSE POSITIVE, caught in live use: the 40-char git SHA in
 * the worker's own "worker starting" line came back as
 * `"commit":"[REDACTED]"`, destroying the one field that proves which build a
 * machine is running - during an incident whose whole question was exactly
 * that. Over-redaction is the safe direction for an UNKNOWN string, but a
 * value whose shape positively identifies it as a digest is not unknown.
 */
const HEX_DIGEST_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

/**
 * Redacts one string. Order matters: keyed values first (so a recognized key
 * redacts its value whatever shape it has), then inline URL credentials,
 * then shape-based fallbacks for unkeyed secrets.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(AUTH_SCHEME_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(SECRET_KEY_PATTERN, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`)
    .replace(URL_CREDENTIALS_PATTERN, (_match, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(OPAQUE_SECRET_PATTERN, (match) => (HEX_DIGEST_PATTERN.test(match) ? match : REDACTED));
}

export function redactLines(lines: readonly string[]): string[] {
  return lines.map((line) => redactSecrets(line));
}

/**
 * Redacts a structured value recursively. Object KEYS are inspected too: a
 * value under a secret-named key is replaced wholesale rather than
 * pattern-matched, because a short password ("hunter2") matches none of the
 * shape patterns above.
 */
export function redactStructured(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactStructured(entry));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSecretKeyName(key) ? REDACTED : redactStructured(entry);
    }
    return output;
  }
  return value;
}

const SECRET_KEY_NAME_PATTERN =
  /(pass|secret|token|apikey|api_?key|credential|authorization|auth|bearer|cookie|session|private_?key|signature|dsn|connection_?string)/i;

export function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_NAME_PATTERN.test(key);
}
