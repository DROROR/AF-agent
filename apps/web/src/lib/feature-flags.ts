/**
 * Login-only mode (2026-08-28): public self-signup is temporarily disabled
 * ahead of client acceptance - flip this back to `true` to re-enable it.
 * Nothing about the Signup implementation itself was touched or removed;
 * see app/(auth)/signup/page.tsx, app/api/auth/signup/route.ts, and
 * components/auth/SignupPageContent.tsx, all of which check this same
 * flag rather than having their own logic deleted.
 */
export const SIGNUP_ENABLED = false;
