import type { SessionRepository, User, UserRepository } from "../../domain/auth/types.js";
import { parseSessionCookieValue } from "../../infrastructure/auth/session-token.js";

export interface ValidateSessionDeps {
  sessionRepository: SessionRepository;
  userRepository: UserRepository;
  verifySessionSecret: (secret: string, storedHash: string) => Promise<boolean>;
  now: () => Date;
}

/**
 * Authoritative session check - every protected route and the dashboard's
 * route-guard middleware both ultimately call this. Returns null (never
 * throws) for anything invalid: malformed token, unknown session, expired
 * session, or a secret that doesn't match - callers turn that into a 401.
 * An expired session is deleted here, opportunistically, the moment it's
 * observed.
 */
export async function validateSession(
  deps: ValidateSessionDeps,
  cookieValue: string
): Promise<User | null> {
  const parsed = parseSessionCookieValue(cookieValue);
  if (!parsed) {
    return null;
  }

  const session = await deps.sessionRepository.findById(parsed.sessionId);
  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= deps.now().getTime()) {
    await deps.sessionRepository.deleteById(session.id);
    return null;
  }

  const secretValid = await deps.verifySessionSecret(parsed.secret, session.tokenHash);
  if (!secretValid) {
    return null;
  }

  return deps.userRepository.findById(session.userId);
}
