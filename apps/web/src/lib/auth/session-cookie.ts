export const SESSION_COOKIE_NAME = "dyo_session";

/**
 * The one place cookie security attributes are decided - every route
 * handler that sets or clears the session cookie imports this so they can
 * never drift apart (CLAUDE.md: HttpOnly, Secure in production, SameSite
 * protection, session expiration, no auth token in localStorage - the
 * cookie is the only place this token ever lives).
 */
export function sessionCookieOptions(maxAgeSeconds?: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge?: number;
} {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    path: "/",
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {})
  };
}

/** No maxAge = a browser-session cookie, cleared when the browser closes (used when "remember me" is unchecked). */
export const CLEARED_SESSION_COOKIE_OPTIONS = { ...sessionCookieOptions(0), maxAge: 0 };
