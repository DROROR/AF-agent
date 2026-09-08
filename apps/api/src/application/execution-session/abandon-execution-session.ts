import { TERMINAL_EXECUTION_SESSION_STATUSES, type ExecutionSessionDto } from "@dyo/schemas";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import { ExecutionSessionNotFoundError, PreconditionNotMetError } from "../../errors/app-error.js";
import { toExecutionSessionDto } from "./execution-session-dto-mapper.js";

export interface AbandonExecutionSessionDeps {
  executionSessionRepository: ExecutionSessionRepository;
  now: () => Date;
}

/**
 * "Abandon Session" (live QA execution-session recovery fix, 2026-09-08) -
 * the explicit, human-triggered escape hatch for a session whose durable
 * checkpoint state can no longer be trusted: an EXECUTE_FRAME job failed
 * AFTER a real AE mutation had already been applied to the working copy,
 * but BEFORE that fact could be durably checkpointed/reported back (e.g. a
 * transient infra failure on the checkpoint/report call itself, not an
 * ordinary AE-mutation failure) - recordExecuteFrameResultIfApplicable
 * deliberately leaves an ordinary job failure's session untouched (still
 * PREPARING/EDITING, "retryable by dispatching EXECUTE_FRAME again for the
 * same scene" - see that function's own doc comment), which is exactly
 * the reuse `create-execution-session.ts`'s own idempotent lookup would
 * then hand back on the very next "start execution" call - correct for a
 * clean retry, but unsafe once the operator has independent reason to
 * believe the working copy on disk is ahead of what the server/session
 * record believes (this exact scenario, confirmed live: a checkpoint POST
 * 404'd immediately after operation 0 physically completed).
 *
 * Reuses the EXISTING "FAILED" terminal status (packages/schemas/src/
 * execution-session.ts) rather than inventing a new one - FAILED already
 * means exactly "this session accepts no further scene edits or renders,
 * start a new one" (see TERMINAL_EXECUTION_SESSION_STATUSES's own doc
 * comment), the identical semantic a working-copy chain-of-custody
 * failure or a rejected preview already produce via the same
 * `markStatus(id, "FAILED", now)` primitive - reject-first-preview.ts
 * uses the exact same call for its own, narrower precondition.
 *
 * Deliberately touches NOTHING else: never the execution plan's own
 * revision/status, never any scene's approvalState, never any mapping,
 * never the source .aep (this function never even resolves a filesystem
 * path - the working copy is entirely the Worker's own concern, derived
 * from the session id it never touches either). The abandoned row is
 * never deleted (schema.ts's own cleanup policy) - still readable by id
 * for forensic value, exactly like an old session left behind by a plan
 * revision change already was (is-session-active.ts's own doc comment).
 * Once FAILED, `is-session-active.ts`'s own check means
 * create-execution-session.ts's next call for this project can no longer
 * reuse it - it creates a genuinely new session (a fresh randomUUID(), and
 * therefore, worker-side, a completely separate
 * sessionWorkingCopyPath(workRoot, id) - see apps/worker/src/workspace/
 * working-copy.ts) at the SAME plan revision, no plan edit required.
 *
 * Refuses (PreconditionNotMetError) a session already in a terminal
 * status - "abandon" is not a valid transition FROM COMPLETED/FAILED,
 * mirroring reject-first-preview.ts's own "nothing to reject" refusal
 * for its own narrower precondition.
 */
export async function abandonExecutionSession(deps: AbandonExecutionSessionDeps, projectId: string, sessionId: string): Promise<ExecutionSessionDto> {
  const session = await deps.executionSessionRepository.findById(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  if (TERMINAL_EXECUTION_SESSION_STATUSES.includes(session.status)) {
    throw new PreconditionNotMetError(`Execution session is already ${session.status} - nothing to abandon`);
  }

  const updated = await deps.executionSessionRepository.markStatus(sessionId, "FAILED", deps.now());
  if (!updated) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  return toExecutionSessionDto(updated);
}
