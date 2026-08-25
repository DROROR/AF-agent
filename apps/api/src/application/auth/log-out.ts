import type { SessionRepository } from "../../domain/auth/types.js";

export interface LogOutDeps {
  sessionRepository: SessionRepository;
}

/** Idempotent - logging out an already-invalid/unknown session is not an error. */
export async function logOut(deps: LogOutDeps, sessionId: string): Promise<void> {
  await deps.sessionRepository.deleteById(sessionId);
}
