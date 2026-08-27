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
