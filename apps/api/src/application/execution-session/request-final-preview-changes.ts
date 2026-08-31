import type { ExecutionSessionDto } from "@dyo/schemas";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import { ExecutionSessionNotFoundError } from "../../errors/app-error.js";
import { toExecutionSessionDto } from "./execution-session-dto-mapper.js";

export interface RequestFinalPreviewChangesDeps {
  executionSessionRepository: ExecutionSessionRepository;
  now: () => Date;
}

/**
 * "Request Changes" (client-handoff phase, "real final preview approval
 * gate", section 5: "Request Changes Safety") - marks the complete
 * preview as not approved, so the client can return to Mappings/Plan and
 * fix content before creating a new preview. Deliberately NOT the same
 * as rejectFirstPreview (which marks the whole session FAILED/terminal):
 * a full-preview "request changes" only ever touches fullPreviewApproved
 * - it never changes session status, never touches completedScenePlanIds
 * or the cumulative working copy, and never dispatches anything. The
 * client's already-completed scene edits (and the real AE working copy
 * they produced) are fully preserved; nothing here reruns a scene or a
 * render. Idempotent and safe to call even if fullPreviewApproved was
 * already false (never errors on "nothing to do").
 */
export async function requestFinalPreviewChanges(deps: RequestFinalPreviewChangesDeps, projectId: string, sessionId: string): Promise<ExecutionSessionDto> {
  const session = await deps.executionSessionRepository.findById(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }

  const updated = await deps.executionSessionRepository.setFullPreviewApproved(sessionId, false, deps.now());
  if (!updated) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  return toExecutionSessionDto(updated);
}
