import { describe, expect, it } from "vitest";
import { resolvePlanEditImpact, type PlanEditImpactInput } from "./plan-edit-impact";

/**
 * REAL 2026-09-27 INCIDENT: configuring the Reels layout after the plan was
 * approved destroyed an approved plan and a completed execution session, and
 * every approval had to be given again. Nothing warned about it.
 *
 * These tests hold both halves of the only property that makes such a warning
 * worth having. A warning that always fires is noise people learn to click
 * past, so "does not fire" is as load-bearing as "fires" - and a warning that
 * stays silent because it could not read the state is the original bug in a
 * new costume, so that case is pinned too.
 */
function input(overrides: Partial<PlanEditImpactInput> = {}): PlanEditImpactInput {
  // A project at the very start: plan still DRAFT, no session has ever run.
  return {
    planApproved: false,
    sessionKnown: true,
    hasSession: false,
    firstPreviewApproved: false,
    fullPreviewApproved: false,
    ...overrides
  };
}

describe("resolvePlanEditImpact", () => {
  it("asks for nothing when there is genuinely nothing to lose - a DRAFT plan with no session saves straight through", () => {
    expect(resolvePlanEditImpact(input())).toEqual({
      requiresConfirmation: false,
      sessionUnknown: false,
      losesPlanApproval: false,
      losesSession: false,
      losesFirstPreviewApproval: false,
      losesFullPreviewApproval: false
    });
  });

  it("names the plan's own approval as the loss when the plan is approved but nothing has been executed yet", () => {
    const impact = resolvePlanEditImpact(input({ planApproved: true }));
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.losesPlanApproval).toBe(true);
    // No session was ever started, so claiming one would be destroyed is a
    // lie that makes the real consequence harder to read.
    expect(impact.losesSession).toBe(false);
    expect(impact.losesFirstPreviewApproval).toBe(false);
    expect(impact.losesFullPreviewApproval).toBe(false);
  });

  it("names a live session even while the plan itself is still a draft - a session is real work regardless of approval", () => {
    const impact = resolvePlanEditImpact(input({ planApproved: false, hasSession: true }));
    expect(impact).toEqual({
      requiresConfirmation: true,
      sessionUnknown: false,
      losesPlanApproval: false,
      losesSession: true,
      losesFirstPreviewApproval: false,
      losesFullPreviewApproval: false
    });
  });

  it("names every real loss at once for the exact shape that bit the operator: approved plan, live session, both previews approved", () => {
    expect(
      resolvePlanEditImpact(input({ planApproved: true, hasSession: true, firstPreviewApproved: true, fullPreviewApproved: true }))
    ).toEqual({
      requiresConfirmation: true,
      sessionUnknown: false,
      losesPlanApproval: true,
      losesSession: true,
      losesFirstPreviewApproval: true,
      losesFullPreviewApproval: true
    });
  });

  it("never reports a preview approval without a session to lose it from - a stale flag alone proves nothing", () => {
    const impact = resolvePlanEditImpact(input({ hasSession: false, firstPreviewApproved: true, fullPreviewApproved: true }));
    expect(impact.requiresConfirmation).toBe(false);
    expect(impact.losesFirstPreviewApproval).toBe(false);
    expect(impact.losesFullPreviewApproval).toBe(false);
  });

  it("an unreadable session asks for confirmation and says so, rather than quietly passing for 'there is no session'", () => {
    const impact = resolvePlanEditImpact(input({ sessionKnown: false }));
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.sessionUnknown).toBe(true);
    // Nothing session-derived may be itemised from a session nobody read.
    expect(impact.losesSession).toBe(false);
    expect(impact.losesFirstPreviewApproval).toBe(false);
    expect(impact.losesFullPreviewApproval).toBe(false);
  });
});
