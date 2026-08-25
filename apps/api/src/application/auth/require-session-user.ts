import { UnauthorizedError } from "../../errors/app-error.js";
import { extractBearerToken } from "../../infrastructure/auth/bearer-token.js";
import type { User } from "../../domain/auth/types.js";
import { validateSession, type ValidateSessionDeps } from "./validate-session.js";

/**
 * Shared by every dashboard-facing route that must not serve data without a
 * valid session (CLAUDE.md: "no public worker/admin data without
 * authentication") - the Authorization header carries the session cookie's
 * value as a bearer token here, the same shape worker-token routes already
 * use, but validated against sessions/users, never workers.
 */
export async function requireSessionUser(
  authorizationHeader: string | undefined,
  deps: ValidateSessionDeps
): Promise<User> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    throw new UnauthorizedError("Missing session token");
  }
  const user = await validateSession(deps, token);
  if (!user) {
    throw new UnauthorizedError("Invalid or expired session");
  }
  return user;
}
