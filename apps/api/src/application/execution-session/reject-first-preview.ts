import type { ExecutionSessionDto } from "@dyo/schemas";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import { ExecutionSessionNotFoundError, PreconditionNotMetError } from "../../errors/app-error.js";
import { toExecutionSessionDto } from "./execution-session-dto-mapper.js";

export interface RejectFirstPreviewDeps {
  executionSessionRepository: ExecutionSessionRepository;
  now: () => Date;
}

/**
 * "Reject Preview" (section 3/10) - the other half of the human preview
 * gate. Only valid while the session is genuinely AWAITING_PREVIEW_APPROVAL
 * - refuses otherwise (never rejects a session that hasn't produced a
 * preview yet, and never re-rejects one already past this gate). Marks
 * the session FAILED (terminal, same as an unrecoverable working-copy
 * chain-of-custody failure - section 7): there is no "revise this preview
 * in place" workflow in this model, only "start a new execution session
 * from a corrected mapping/plan" (section 11's own escape hatch) - the
 * session's cumulative working copy up to this point is left alone
 * (never deleted, matching schema.ts's own cleanup policy) but is never
 * rendered from.
 */
export async function rejectFirstPreview(deps: RejectFirstPreviewDeps, projectId: string, sessionId: string): Promise<ExecutionSessionDto> {
  const session = await deps.executionSessionRepository.findById(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  if (session.status !== "AWAITING_PREVIEW_APPROVAL") {
    throw new PreconditionNotMetError(`Execution session is ${session.status}, not AWAITING_PREVIEW_APPROVAL - nothing to reject`);
  }

  const updated = await deps.executionSessionRepository.markStatus(sessionId, "FAILED", deps.now());
  if (!updated) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  return toExecutionSessionDto(updated);
}
