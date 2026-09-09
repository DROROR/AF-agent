import { TERMINAL_EXECUTION_SESSION_STATUSES, type ExecutionSessionStatus } from "@dyo/schemas";

export interface ActiveSessionCheckInput {
  status: ExecutionSessionStatus;
  planRevision: number;
}

/**
 * "Active" is never a separate DB query/flag - it's derived, at read time,
 * by comparing the session's own bound planRevision against the CURRENT
 * plan's real revision (section 11: "if the execution plan changes after
 * a session begins, do NOT silently apply the new revision to the
 * existing session"). A session bound to an OLDER revision is simply
 * abandoned/orphaned (still readable by id for forensic value, never
 * deleted), never auto-migrated - the only way forward is a fresh session
 * (create-execution-session.ts).
 */
export function isSessionActive(session: ActiveSessionCheckInput, currentPlanRevision: number): boolean {
  if (TERMINAL_EXECUTION_SESSION_STATUSES.includes(session.status)) {
    return false;
  }
  return session.planRevision === currentPlanRevision;
}

export interface RecoverableForPreviewRegenerationCheckInput extends ActiveSessionCheckInput {
  completedScenePlanIds: string[];
  latestWorkingProjectSha256: string | null;
  latestPreviewScenePlanId: string | null;
}

/**
 * First Preview regeneration (live QA, 2026-09-08/09) - a session
 * isSessionActive correctly calls NOT active (FAILED is terminal), but
 * that still genuinely has real completed work and a prior preview worth
 * recovering: rejecting a preview marks the session FAILED by design
 * (section 11's "no revise in place" for a genuinely bad edit), but the
 * real 2026-09-08 incident proved that design never anticipated "the
 * edit was fine, only the captured FRAME was unrepresentative" as a
 * distinct case. Shared by resolveRegeneratePreviewOnly (apps/api's
 * dispatch-time preconditions) and getCurrentExecutionSession (so the
 * dashboard's own "current session" read ever returns this session at
 * all, instead of silently seeing null and falling back to "Start
 * execution" - the exact 2026-09-09 bug this closes) - kept as ONE
 * predicate so the two can never drift apart.
 *
 * Deliberately narrow, never a general "un-fail any session" escape
 * hatch: a FAILED session from a genuine chain-of-custody violation, or
 * one that never got far enough to have a working copy or a preview at
 * all, is excluded (all three of completedScenePlanIds/
 * latestWorkingProjectSha256/latestPreviewScenePlanId must be real) -
 * refused exactly as before by everything else that already treats
 * FAILED as terminal.
 */
export function isRecoverableForPreviewRegeneration(session: RecoverableForPreviewRegenerationCheckInput, currentPlanRevision: number): boolean {
  return (
    session.status === "FAILED" &&
    session.planRevision === currentPlanRevision &&
    session.completedScenePlanIds.length > 0 &&
    session.latestWorkingProjectSha256 !== null &&
    session.latestPreviewScenePlanId !== null
  );
}
