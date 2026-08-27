import { describe, expect, it } from "vitest";
import type { SceneEditOperation } from "@dyo/schemas";
import { HeroicSwanAeEditBridge, NotAvailableAeEditBridge, AeMutationTransportUnavailableError, type AeMutationClient } from "../ae-edit-bridge.js";
import type { FixedJsxScript } from "../jsx-templates.js";
import type { MutationCallResult } from "../heroic-swan-ae-mutation-client.js";

const SET_TEXT_OP: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Hello" };
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

describe("NotAvailableAeEditBridge", () => {
  it("never fabricates a result - always throws AeMutationTransportUnavailableError", async () => {
    const bridge = new NotAvailableAeEditBridge();
    await expect(bridge.applyOperation({ aeProjectItemIndex: 0, compositionName: COMP_NAME, operation: SET_TEXT_OP })).rejects.toBeInstanceOf(
      AeMutationTransportUnavailableError
    );
    await expect(bridge.saveProject()).rejects.toBeInstanceOf(AeMutationTransportUnavailableError);
  });
});
