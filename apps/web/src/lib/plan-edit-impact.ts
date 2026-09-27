/**
 * "If I save this, what do I lose?" - the real, derived answer for any edit
 * that writes a new execution-plan revision.
 *
 * REAL 2026-09-27 INCIDENT (docs/ACCEPTANCE.md, "Configuring the Reels
 * layout invalidates the session"). Setting the Reels layout is a plan
 * edit: update-execution-plan.ts writes revision N+1 with `status: "DRAFT"`
 * and `approvedAt: null`, and a session is only ever returned as current
 * while its own `planRevision` equals the plan's (is-session-active.ts), so
 * one save simultaneously
 *
 *   - un-approves the plan,
 *   - orphans the live execution session, and
 *   - takes both of that session's preview approvals with it.
 *
 * That is the approval model working exactly as designed - a plan the human
 * has not seen must not stay approved. What was missing is that NOTHING said
 * so. The operator configured the Reels layout after approving, on the
 * guidance's own recommended order, and lost an approved plan and a
 * completed session; every approval had to be redone by hand.
 *
 * Two rules this module exists to hold:
 *
 *  1. WARN ONLY ABOUT A REAL LOSS. A DRAFT plan with no session has nothing
 *     to lose, and a confirmation step there is pure noise - the kind that
 *     teaches people to click through warnings without reading them, which
 *     would destroy the value of the one warning that matters.
 *
 *  2. NEVER CLAIM "NOTHING WILL BE LOST" WITHOUT HAVING LOOKED. If the
 *     current session genuinely could not be read, that is not the same as
 *     "there is no session" - the exact conflation
 *     use-project-stepper-status.ts's own `hasError` was added to end. An
 *     unreadable session state therefore still asks for confirmation, and
 *     says plainly that it could not be read.
 *
 * Pure: no I/O, no React, so every branch is unit-testable without
 * rendering (see plan-edit-impact.test.ts).
 */

export interface PlanEditImpactInput {
  /**
   * The plan's own persisted status is APPROVED. Read from the workspace's
   * existing project+plan load, which is always present on any screen that
   * can edit a plan - so this is never unknown.
   */
  planApproved: boolean;
  /**
   * False while the current execution session is still being read, AND when
   * that read genuinely failed. Never flattened into `hasSession: false` -
   * see rule 2 above.
   */
  sessionKnown: boolean;
  /**
   * A session was returned by GET .../execution-sessions/current. That
   * endpoint only ever returns a session bound to the CURRENT plan revision
   * (active, or a FAILED one still recoverable for preview regeneration), so
   * any session it returns is precisely a session the next revision orphans.
   */
  hasSession: boolean;
  /** That session's own persisted firstPreviewApproved flag - never inferred. */
  firstPreviewApproved: boolean;
  /** That session's own persisted fullPreviewApproved flag - never inferred. */
  fullPreviewApproved: boolean;
}

export interface PlanEditImpact {
  /**
   * There is something real to lose, or we could not read enough to say
   * there isn't. The only state in which an edit may be saved silently is
   * `false`.
   */
  requiresConfirmation: boolean;
  /** The current session could not be read, so the loss cannot be listed in full. Say so; never fill the gap with a guess. */
  sessionUnknown: boolean;
  losesPlanApproval: boolean;
  losesSession: boolean;
  losesFirstPreviewApproval: boolean;
  losesFullPreviewApproval: boolean;
}

export function resolvePlanEditImpact(input: PlanEditImpactInput): PlanEditImpact {
  const sessionUnknown = !input.sessionKnown;
  // Every session-derived consequence is gated on having actually read the
  // session, so an unread session can never be reported as a concrete,
  // itemised loss - only as the honest "we could not tell".
  const losesSession = input.sessionKnown && input.hasSession;
  return {
    sessionUnknown,
    losesPlanApproval: input.planApproved,
    losesSession,
    losesFirstPreviewApproval: losesSession && input.firstPreviewApproved,
    losesFullPreviewApproval: losesSession && input.fullPreviewApproved,
    requiresConfirmation: input.planApproved || losesSession || sessionUnknown
  };
}
