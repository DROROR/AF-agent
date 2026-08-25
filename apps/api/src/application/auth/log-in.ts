import type { LogInRequest } from "@dyo/schemas";
import type { User, UserRepository } from "../../domain/auth/types.js";
import { InvalidCredentialsError } from "../../errors/app-error.js";
import { createSession, type CreateSessionDeps, type CreatedSession } from "./create-session.js";
import { DEFAULT_SESSION_TTL_MS, REMEMBER_ME_SESSION_TTL_MS } from "./session-ttl.js";

export interface LogInDeps extends CreateSessionDeps {
  userRepository: UserRepository;
  verifyPassword: (password: string, storedHash: string) => Promise<boolean>;
  getDummyPasswordHash: () => Promise<string>;
}

export interface LogInResult extends CreatedSession {
  user: User;
}

/**
 * Whether the email doesn't exist or the password is wrong, this throws the
 * exact same InvalidCredentialsError - a response must never let a caller
 * distinguish "no such account" from "wrong password" (user enumeration).
 * verifyPassword still runs against a real (dummy) hash even when no user
 * is found, so the two cases also take statistically the same time.
 */
export async function logIn(deps: LogInDeps, request: LogInRequest): Promise<LogInResult> {
  const user = await deps.userRepository.findByEmail(request.email);
  const hashToCheck = user ? user.passwordHash : await deps.getDummyPasswordHash();
  const passwordValid = await deps.verifyPassword(request.password, hashToCheck);

  if (!user || !passwordValid) {
    throw new InvalidCredentialsError();
  }

  const loginTime = deps.now();
  await deps.userRepository.updateLastLoginAt(user.id, loginTime);
  const ttlMs = request.rememberMe ? REMEMBER_ME_SESSION_TTL_MS : DEFAULT_SESSION_TTL_MS;
  const session = await createSession(deps, user.id, ttlMs);
  // updateLastLoginAt() doesn't return the updated row - reflect it here so
  // the response the caller just triggered doesn't show a stale lastLoginAt.
  return { user: { ...user, lastLoginAt: loginTime }, ...session };
}
