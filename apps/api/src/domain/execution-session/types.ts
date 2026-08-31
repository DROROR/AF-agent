import type { ExecutionSessionStatus } from "@dyo/schemas";

export interface ExecutionSessionRecord {
  id: string;
  projectId: string;
  executionPlanId: string;
  planRevision: number;
  sourceProjectSha256: string;
  assignedWorkerId: string;
  status: ExecutionSessionStatus;
  latestWorkingProjectSha256: string | null;
  completedScenePlanIds: string[];
  firstPreviewApproved: boolean;
  /** Null until the session's first scene edit has ever captured+uploaded a preview - see schema.ts's own doc comment on these four columns. */
  latestPreviewStorageKey: string | null;
  latestPreviewSha256: string | null;
  latestPreviewScenePlanId: string | null;
  latestPreviewCapturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewExecutionSession {
  id: string;
  projectId: string;
  executionPlanId: string;
  planRevision: number;
  sourceProjectSha256: string;
  assignedWorkerId: string;
}

/**
 * Port the application layer depends on. Every write method is
 * purpose-specific (mirrors ExecutionPlanRepository's own
 * updateStatus/updateRenderOutput/updateWorkingCopy convention) rather than
 * one generic "patch" method - the caller always already knows exactly
 * which real event occurred (a scene completed, preview was approved, a
 * chain-of-custody failure was reported), and the pure
 * derive-status.ts/derive-display-status.ts functions compute the right
 * `status` value BEFORE calling in, so no repository method ever guesses
 * a status transition on its own.
 */
export interface ExecutionSessionRepository {
  create(session: NewExecutionSession, now: Date): Promise<ExecutionSessionRecord>;
  findById(id: string): Promise<ExecutionSessionRecord | null>;
  /** The most recently created session for this project, terminal or not - callers decide what "active" means (see is-session-active.ts) by comparing its own planRevision/status against fresh state, never a specialized query here. */
  findLatestByProjectId(projectId: string): Promise<ExecutionSessionRecord | null>;
  /** Every session ever created for this project, any status - used by delete-project.ts to collect every historical session's own preview storageKey (not just the latest one) before deleting their files. */
  listByProjectId(projectId: string): Promise<ExecutionSessionRecord[]>;
  /**
   * Appends `scenePlanId` to completedScenePlanIds (idempotent - a
   * duplicate call for the same scenePlanId is a no-op on the array but
   * still updates latestWorkingProjectSha256/status/updatedAt) and updates
   * the chain-of-custody head sha256 - called only after a REAL
   * EXECUTE_FRAME job succeeds (see record-execute-frame-result.ts).
   * `status` is the caller-computed next status (derive-status.ts) - never
   * computed here. Returns null only if `id` doesn't exist.
   */
  recordSceneCompleted(id: string, scenePlanId: string, workingProjectSha256: string, status: ExecutionSessionStatus, now: Date): Promise<ExecutionSessionRecord | null>;
  /** Flips firstPreviewApproved to true and applies the caller-computed next status - only ever called from approve-first-preview.ts. Returns null only if `id` doesn't exist. */
  approvePreview(id: string, status: ExecutionSessionStatus, now: Date): Promise<ExecutionSessionRecord | null>;
  /** A bare status transition with no other field change - used for FAILED (a working-copy chain-of-custody failure - section 7) and for resetting after a render outcome. Returns null only if `id` doesn't exist. */
  markStatus(id: string, status: ExecutionSessionStatus, now: Date): Promise<ExecutionSessionRecord | null>;
  /**
   * Overwrites the session's current preview identity - called only after
   * the worker's real preview bytes are already durably stored (see
   * upload-preview.ts). Never appends/accumulates: a session has exactly
   * one current preview, so this always replaces whatever was there
   * before. Returns the record's PRIOR preview fields alongside the
   * updated record so the caller can delete the old stored object only
   * AFTER the new one is durably on record (never before - same ordering
   * upload-render-artifact.ts already established). Returns null only if
   * `id` doesn't exist.
   */
  recordPreview(
    id: string,
    preview: { storageKey: string; sha256: string; scenePlanId: string; capturedAt: Date },
    now: Date
  ): Promise<{ record: ExecutionSessionRecord; priorStorageKey: string | null } | null>;
}
