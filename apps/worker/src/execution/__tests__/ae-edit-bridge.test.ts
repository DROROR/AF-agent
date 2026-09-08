import { describe, expect, it } from "vitest";
import type { SceneEditOperation } from "@dyo/schemas";
import { HeroicSwanAeEditBridge, NotAvailableAeEditBridge, AeMutationTransportUnavailableError, type AeMutationClient } from "../ae-edit-bridge.js";
import type { FixedJsxScript } from "../jsx-templates.js";
import type { MutationCallResult } from "../heroic-swan-ae-mutation-client.js";

const SET_TEXT_OP: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: "Hello" };
const COMP_NAME = "Test Comp";

/**
 * Builds the REAL double-envelope shape ae_run_jsx actually returns
 * (verified 2026-08-27 from host-scripts/ae-mcp-methods.jsx's
 * `system.runJsx` case): the host wraps our script's own
 * `JSON.stringify(...)` return value as `{ result: "<that string>" }`,
 * and the MCP text block wraps THAT again. Never the single envelope
 * this test file wrongly assumed before that verification.
 */
function hostRunJsxContent(scriptResult: unknown): unknown {
  return [{ type: "text", text: JSON.stringify({ result: JSON.stringify(scriptResult) }) }];
}

class FakeMutationClient implements AeMutationClient {
  connectCalls = 0;
  closeCalls = 0;
  lastScript: FixedJsxScript | null = null;

  constructor(private readonly result: MutationCallResult) {}

  async connect(): Promise<void> {
    this.connectCalls++;
  }
  async close(): Promise<void> {
    this.closeCalls++;
  }
  async runFixedOperation(script: FixedJsxScript): Promise<MutationCallResult> {
    this.lastScript = script;
    return this.result;
  }
}

describe("HeroicSwanAeEditBridge", () => {
  it("returns a typed success result and always closes the client, given a well-formed AE-side success", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: true, previousValue: "old", resultingValue: "Hello" }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(result).toEqual({ ok: true, operationType: "SET_TEXT", previousValue: "old", resultingValue: "Hello" });
    expect(fake.connectCalls).toBe(1);
    expect(fake.closeCalls).toBe(1);
  });

  it("passes the exact script jsx-templates.ts would build for this operation", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: true }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    await bridge.applyOperation({ aeProjectItemIndex: 7, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(fake.lastScript).toContain("app.project.item(7)");
    expect(fake.lastScript).toContain(JSON.stringify("Hello"));
  });

  it("surfaces an AE-side typed failure (script ran, but reported ok:false) without throwing", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: false, failureReason: "target layer is not a text layer" }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(result).toEqual({ ok: false, operationType: "SET_TEXT", failureReason: "target layer is not a text layer" });
    expect(fake.closeCalls).toBe(1);
  });

  it("surfaces a tool-call failure (ae_run_jsx itself failed) as a typed failure", async () => {
    const fake = new FakeMutationClient({ ok: false, error: { code: "TOOL_ERROR", message: "comp not found" } });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("TOOL_ERROR");
    expect(fake.closeCalls).toBe(1);
  });

  it("fails closed on a malformed AE-side response (not the expected shape) rather than crashing or fabricating success", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ somethingElse: true }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("did not match the expected");
  });

  it("fails closed on the OLD (wrong, pre-verification) single-envelope shape - regression test proving the double-envelope fix matters", async () => {
    // The bug this guards against: before the real upstream source was
    // read, this bridge assumed ae_run_jsx returned the script's own
    // result directly, with no {result: ...} host wrapper. Feeding that
    // old (wrong) shape in must fail closed, never silently "work" by
    // coincidence.
    const fake = new FakeMutationClient({ ok: true, content: [{ type: "text", text: JSON.stringify({ ok: true, resultingValue: "Hello" }) }] });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("did not match the expected host envelope");
  });

  it("fails closed when the envelope's own result field is not valid JSON", async () => {
    const fake = new FakeMutationClient({ ok: true, content: [{ type: "text", text: JSON.stringify({ result: "not valid json {" }) }] });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("could not be parsed");
  });

  it("fails closed when the response content has no parseable JSON text block", async () => {
    const fake = new FakeMutationClient({ ok: true, content: "not an array" });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(result.ok).toBe(false);
  });

  it("closes the client even when connect() itself throws", async () => {
    let closeCalls = 0;
    const throwingClient: AeMutationClient = {
      connect: () => Promise.reject(new Error("spawn failed")),
      close: async () => {
        closeCalls++;
      },
      runFixedOperation: () => Promise.reject(new Error("should never be called"))
    };
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => throwingClient });

    const result = await bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("spawn failed");
    expect(closeCalls).toBe(1);
  });
});

describe("HeroicSwanAeEditBridge.saveProject", () => {
  it("returns a typed success result on a real save", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: true, resultingValue: "/work/working-copy.aep" }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.saveProject();

    expect(result).toEqual({ ok: true, resultingValue: "/work/working-copy.aep" });
    expect(fake.lastScript).toContain("app.project.save()");
  });

  it("surfaces a save failure as a typed failure, never throwing", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: false, failureReason: "disk full" }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.saveProject();

    expect(result).toEqual({ ok: false, failureReason: "disk full" });
  });
});

describe("HeroicSwanAeEditBridge.openProject (CRITICAL SAFETY FIX, live QA 2026-09-08 real incident)", () => {
  const WORKING_COPY_PATH = "C:\\DYO-Agent\\execution-sessions\\session-1\\working-copy.aep";

  it("returns ok:true with the confirmed opened path when AE's own self-reported path matches exactly", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: true, resultingValue: { openedPath: WORKING_COPY_PATH, openedName: "working-copy.aep" } })
    });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.openProject(WORKING_COPY_PATH);

    expect(result).toEqual({ ok: true, openedPath: WORKING_COPY_PATH });
    expect(fake.lastScript).toContain("app.open(");
  });

  it("case-insensitive, separator-normalized match still succeeds - the same real Windows path reported with different casing/slashes", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: true, resultingValue: { openedPath: "c:\\dyo-agent\\execution-sessions\\session-1\\WORKING-COPY.AEP", openedName: "working-copy.aep" } })
    });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.openProject(WORKING_COPY_PATH);

    expect(result.ok).toBe(true);
  });

  it("fails closed - never proceeds - when AE reports a DIFFERENT project is open (the exact real incident: the immutable source, not the working copy)", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: true, resultingValue: { openedPath: "C:\\DYO-Agent\\copies\\dro-template-converted.aep", openedName: "dro-template-converted.aep" } })
    });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.openProject(WORKING_COPY_PATH);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("dro-template-converted.aep");
    expect(result.failureReason).toContain("not the requested working copy");
  });

  it("fails closed when AE reports no project open at all after the open attempt", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: true, resultingValue: { openedPath: null, openedName: null } })
    });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.openProject(WORKING_COPY_PATH);

    expect(result.ok).toBe(false);
  });

  it("surfaces the open-project script's own typed failure (e.g. app.open() returned false) without throwing", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: false, failureReason: "app.open() did not return an opened project" }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.openProject(WORKING_COPY_PATH);

    expect(result).toEqual({ ok: false, failureReason: "app.open() did not return an opened project" });
  });

  it("fails closed on a malformed resultingValue shape rather than crashing or guessing", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: true, resultingValue: { somethingElse: true } }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.openProject(WORKING_COPY_PATH);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("did not match the expected");
  });

  it("passes the exact requested path to buildOpenProjectScript - the script targets THIS working copy, never a hardcoded/guessed one", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: true, resultingValue: { openedPath: WORKING_COPY_PATH, openedName: "working-copy.aep" } }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    await bridge.openProject(WORKING_COPY_PATH);

    expect(fake.lastScript).toContain(JSON.stringify(WORKING_COPY_PATH));
  });
});

describe("NotAvailableAeEditBridge", () => {
  it("never fabricates a result - always throws AeMutationTransportUnavailableError, including for openProject", async () => {
    const bridge = new NotAvailableAeEditBridge();
    await expect(bridge.openProject("C:\\any\\path.aep")).rejects.toBeInstanceOf(AeMutationTransportUnavailableError);
    await expect(bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP })).rejects.toBeInstanceOf(
      AeMutationTransportUnavailableError
    );
    await expect(bridge.saveProject()).rejects.toBeInstanceOf(AeMutationTransportUnavailableError);
  });
});
