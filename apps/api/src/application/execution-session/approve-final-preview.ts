import type { ExecutionSessionDto } from "@dyo/schemas";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { FullPreviewArtifactRepository } from "../../domain/full-preview-artifact/types.js";
import { ExecutionSessionNotFoundError, PreconditionNotMetError } from "../../errors/app-error.js";
import { toExecutionSessionDto } from "./execution-session-dto-mapper.js";

export interface ApproveFinalPreviewDeps {
  executionSessionRepository: ExecutionSessionRepository;
  fullPreviewArtifactRepository: FullPreviewArtifactRepository;
  now: () => Date;
}

/**
 * "Approve Final Preview" (client-handoff phase, "real final preview
 * approval gate") - the SEPARATE, later human gate between the assembled
 * full-preview video and the final Landscape/Reels render (never the
 * same gate as approveFirstPreview - see execution_sessions.fullPreviewApproved's
 * own doc comment). Only valid while a real full-preview artifact exists
 * for this session AND its own workingProjectSha256 still matches the
 * session's CURRENT latestWorkingProjectSha256 - never approves a
 * missing or stale (captured against an older working copy) preview,
 * same "freshness" rule resolve-render-dispatch.ts itself enforces
 * before ever dispatching a render.
 */
export async function approveFinalPreview(deps: ApproveFinalPreviewDeps, projectId: string, sessionId: string): Promise<ExecutionSessionDto> {
  const session = await deps.executionSessionRepository.findById(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }

  const latestFullPreview = await deps.fullPreviewArtifactRepository.findLatestForSession(sessionId);
  if (!latestFullPreview || latestFullPreview.workingProjectSha256 !== session.latestWorkingProjectSha256) {
    throw new PreconditionNotMetError("No complete preview exists yet for the current working copy - create one before approving it");
  }

  const updated = await deps.executionSessionRepository.setFullPreviewApproved(sessionId, true, deps.now());
  if (!updated) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  return toExecutionSessionDto(updated);
}
