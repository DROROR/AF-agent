import { describe, expect, it, vi } from "vitest";
import type { WorkMap } from "@dyo/schemas";
import { AI_DRAFT_STILL_RUNNING_MESSAGE, isAiDraftOutcomeUnknown, settleAiWorkMapDraft } from "./ai-draft-settle";
import type { ApiResult } from "./projects-api-client";

const workMap = (revision: number): WorkMap => ({ revision, entries: [], aiSummary: null }) as unknown as WorkMap;

function clock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    }
  };
}

describe("isAiDraftOutcomeUnknown", () => {
  it("is unknown after our own timeout, a gateway timeout, a bad gateway or no response at all", () => {
    expect(isAiDraftOutcomeUnknown({ ok: false, status: 0, code: "TIMED_OUT", message: "" })).toBe(true);
    expect(isAiDraftOutcomeUnknown({ ok: false, status: 504, code: null, message: "" })).toBe(true);
    expect(isAiDraftOutcomeUnknown({ ok: false, status: 502, code: null, message: "" })).toBe(true);
    expect(isAiDraftOutcomeUnknown({ ok: false, status: 0, code: null, message: "" })).toBe(true);
  });

  it("is known for a success and for a real refusal the server answered", () => {
    expect(isAiDraftOutcomeUnknown({ ok: true, data: workMap(1) })).toBe(false);
    expect(isAiDraftOutcomeUnknown({ ok: false, status: 503, code: "AI_PROVIDER_NOT_CONFIGURED", message: "" })).toBe(false);
    expect(isAiDraftOutcomeUnknown({ ok: false, status: 400, code: "VALIDATION_ERROR", message: "" })).toBe(false);
  });
});

describe("settleAiWorkMapDraft (real 2026-10-08: the plan finished 48 s after the browser gave up)", () => {
  it("returns the server's own answer at once when it arrived", async () => {
    const poll = vi.fn();
    const result = await settleAiWorkMapDraft(0, { post: async () => ({ ok: true, data: workMap(1) }), poll, ...clock() });
    expect(result).toEqual({ ok: true, data: workMap(1) });
    expect(poll).not.toHaveBeenCalled();
  });

  it("returns a real refusal as it is, without waiting", async () => {
    const refused: ApiResult<WorkMap> = { ok: false, status: 503, code: "AI_PROVIDER_NOT_CONFIGURED", message: "Connect a provider" };
    const poll = vi.fn();
    const result = await settleAiWorkMapDraft(0, { post: async () => refused, poll, ...clock() });
    expect(result).toBe(refused);
    expect(poll).not.toHaveBeenCalled();
  });

  it("after a timeout, keeps watching the work map and succeeds with the newer revision the server wrote", async () => {
    const polls: Array<ApiResult<WorkMap | null>> = [
      { ok: true, data: workMap(3) },
      { ok: false, status: 0, code: null, message: "blip" },
      { ok: true, data: workMap(4) }
    ];
    const poll = vi.fn(async (): Promise<ApiResult<WorkMap | null>> => polls.shift() ?? { ok: true, data: workMap(4) });
    const result = await settleAiWorkMapDraft(3, {
      post: async () => ({ ok: false, status: 0, code: "TIMED_OUT", message: "took too long" }),
      poll,
      ...clock()
    });
    expect(result).toEqual({ ok: true, data: workMap(4) });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("a work map at the same revision as before is not the new plan - a stale read never counts", async () => {
    const poll = vi.fn(async () => ({ ok: true, data: workMap(3) }) as ApiResult<WorkMap | null>);
    const result = await settleAiWorkMapDraft(3, {
      post: async () => ({ ok: false, status: 504, code: null, message: "gateway" }),
      poll,
      ...clock(),
      maxWaitMs: 20,
      pollMs: 10
    });
    expect(result).toEqual({ ok: false, status: 504, code: "STILL_RUNNING", message: AI_DRAFT_STILL_RUNNING_MESSAGE });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("when the bounded wait runs out it says the plan may still arrive and asks for a reload - never 'failed, try again'", async () => {
    const result = await settleAiWorkMapDraft(0, {
      post: async () => ({ ok: false, status: 0, code: "TIMED_OUT", message: "took too long" }),
      poll: async () => ({ ok: true, data: null }),
      ...clock(),
      maxWaitMs: 15,
      pollMs: 5
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("STILL_RUNNING");
      expect(result.message).toContain("Reload this page");
      expect(result.message).not.toMatch(/try again/i);
    }
  });
});
