import type { SessionRepository } from "../../domain/auth/types.js";
import type { GeneratedSessionToken } from "../../infrastructure/auth/session-token.js";

export interface CreateSessionDeps {
  sessionRepository: SessionRepository;
  generateSessionToken: () => GeneratedSessionToken;
  hashSessionSecret: (secret: string) => Promise<string>;
  now: () => Date;
}

export interface CreatedSession {
  cookieValue: string;
  expiresAt: Date;
}

/** Shared by sign-up and log-in - a fresh session always starts identically, whichever flow created it. */
export async function createSession(
  deps: CreateSessionDeps,
  userId: string,
  ttlMs: number
): Promise<CreatedSession> {
  const token = deps.generateSessionToken();
  const tokenHash = await deps.hashSessionSecret(token.secret);
  const expiresAt = new Date(deps.now().getTime() + ttlMs);
  await deps.sessionRepository.create({ id: token.sessionId, userId, tokenHash, expiresAt });
  return { cookieValue: token.cookieValue, expiresAt };
}
