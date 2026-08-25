/** Shared by sign-up (always this TTL) and log-in (this TTL, or the remember-me TTL) so a session created either way expires consistently. */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const REMEMBER_ME_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
