import { randomUUID } from "node:crypto";
import type { SignUpRequest } from "@dyo/schemas";
import { DuplicateEmailError, type User, type UserRepository } from "../../domain/auth/types.js";
import { EmailAlreadyRegisteredError } from "../../errors/app-error.js";
import { createSession, type CreateSessionDeps, type CreatedSession } from "./create-session.js";

export interface SignUpDeps extends CreateSessionDeps {
  userRepository: UserRepository;
  hashPassword: (password: string) => Promise<string>;
  sessionTtlMs: number;
}

export interface SignUpResult extends CreatedSession {
  user: User;
}

/**
 * A brand-new account is logged in immediately, same as most SaaS signup
 * flows - the email uniqueness check happens twice: an app-level
 * pre-check (deps.userRepository.findByEmail) for a fast, friendly error
 * in the common case, and the DB's own unique constraint as the real
 * authority for the rare concurrent-signup race (surfaced here as
 * DuplicateEmailError from the repository).
 */
export async function signUp(deps: SignUpDeps, request: SignUpRequest): Promise<SignUpResult> {
  const existing = await deps.userRepository.findByEmail(request.email);
  if (existing) {
    throw new EmailAlreadyRegisteredError();
  }

  const passwordHash = await deps.hashPassword(request.password);
  let user: User;
  try {
    user = await deps.userRepository.create(
      { id: randomUUID(), name: request.name, email: request.email, passwordHash },
      deps.now()
    );
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      throw new EmailAlreadyRegisteredError();
    }
    throw error;
  }

  const session = await createSession(deps, user.id, deps.sessionTtlMs);
  return { user, ...session };
}
