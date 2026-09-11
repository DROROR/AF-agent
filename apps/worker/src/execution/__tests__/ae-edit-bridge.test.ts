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

  it("never fabricates a result for resolveCompositionIndex either", async () => {
    const bridge = new NotAvailableAeEditBridge();
    await expect(bridge.resolveCompositionIndex("comp-1", COMP_NAME)).rejects.toBeInstanceOf(AeMutationTransportUnavailableError);
  });
});

/**
 * CRITICAL SAFETY FIX (real 2026-09-11 incident, session a7fee3d9): the
 * same durable-CompItem.id resolution CREATE_PREVIEW/RENDER/
 * INSPECT_SCENE_EVIDENCE already use, now on EXECUTE_FRAME's own
 * mutation channel (real 2026-09-11 EXECUTE_FRAME durable-identity fix).
 * Deliberately bypasses this bridge's own `runScript` (that helper's
 * scriptResultSchema expects the mutation-script envelope
 * {ok,previousValue,resultingValue,failureReason} - the shared resolve
 * script returns its own top-level fields directly, see
 * resolve-composition-index.ts) - these tests prove the real
 * connect/run/close lifecycle around that separate path.
 */
describe("HeroicSwanAeEditBridge.resolveCompositionIndex (real 2026-09-11 EXECUTE_FRAME durable-identity fix)", () => {
  it("never even connects to ae-mcp when manifestCompositionId carries no durable numeric id (e.g. a BUILD_HORIZONTAL_COMPOSITION-derived master) - resolved:false, no regression", async () => {
    const fake = new FakeMutationClient({ ok: true, content: [] });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.resolveCompositionIndex("landscape-master-derived-abc123", COMP_NAME);

    expect(result).toEqual({ ok: true, resolved: false });
    expect(fake.connectCalls).toBe(0);
  });

  it("resolves a real durable numeric id to its current aeProjectItemIndex, and always closes the client", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: true, resolvedAeProjectItemIndex: 48, name: COMP_NAME, widthPx: 1920, heightPx: 1080, frameRate: 29.97, durationSeconds: 7.007 })
    });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.resolveCompositionIndex("comp-1", COMP_NAME);

    expect(result).toEqual({ ok: true, resolved: true, aeProjectItemIndex: 48 });
    expect(fake.connectCalls).toBe(1);
    expect(fake.closeCalls).toBe(1);
  });

  it("fails closed with the script's own honest reason when the id no longer resolves to anything - never fabricates a resolved index", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: false, failureReason: "no composition with id 1 exists in this project" }) });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.resolveCompositionIndex("comp-1", COMP_NAME);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("no composition with id 1 exists");
    expect(fake.closeCalls).toBe(1);
  });

  it("fails closed (and still closes the client) when the mutation call itself errors", async () => {
    const fake = new FakeMutationClient({ ok: false, error: { code: "TOOL_ERROR", message: "simulated ae_run_jsx failure" } });
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => fake });

    const result = await bridge.resolveCompositionIndex("comp-1", COMP_NAME);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("simulated ae_run_jsx failure");
    expect(fake.closeCalls).toBe(1);
  });

  it("fails closed when connect() itself throws, and still closes the client", async () => {
    const throwingClient: AeMutationClient = {
      connect: async () => {
        throw new Error("simulated connect failure");
      },
      close: async () => {},
      runFixedOperation: async () => ({ ok: true, content: [] })
    };
    let closeCalls = 0;
    const trackedClient: AeMutationClient = { ...throwingClient, close: async () => { closeCalls++; } };
    const bridge = new HeroicSwanAeEditBridge({ createMutationClient: () => trackedClient });

    const result = await bridge.resolveCompositionIndex("comp-1", COMP_NAME);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureReason).toContain("could not connect to ae-mcp");
    expect(closeCalls).toBe(1);
  });
});
