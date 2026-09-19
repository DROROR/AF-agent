import { describe, expect, it } from "vitest";
import { MAX_VERIFIABLE_TEXT_CODE_UNITS, computeTextVerification } from "@dyo/schemas";
import { LAYER_TEXT_SLICE_MAX_LENGTH } from "../execution/jsx-templates.js";
import { readCompleteTextVerification, type RunSliceScript } from "./complete-template-text.js";

const TARGET = { aeProjectItemIndex: 3, compositionName: "Any Comp", layerIndex: 2 };

/** A fake After Effects that serves one layer's text in slices, exactly as the real script does. */
function serving(text: string, overrides: { totalOverride?: (call: number) => number; failAtCall?: number; emptyAfter?: number } = {}): { run: RunSliceScript; calls: number } {
  const state = { calls: 0 };
  const run: RunSliceScript = async (script) => {
    state.calls += 1;
    if (overrides.failAtCall === state.calls) {
      return { ok: false, reason: "simulated MCP failure" };
    }
    // The real script interpolates its own start offset; read it back so this
    // fake serves exactly the slice that was asked for.
    const startMatch = /var __start = (\d+);/.exec(script);
    const countMatch = /var __count = (\d+);/.exec(script);
    const start = Number(startMatch?.[1] ?? 0);
    const count = Number(countMatch?.[1] ?? LAYER_TEXT_SLICE_MAX_LENGTH);
    const slice = overrides.emptyAfter !== undefined && state.calls > overrides.emptyAfter ? "" : text.slice(start, start + count);
    return {
      ok: true,
      value: {
        resultingValue: {
          totalCodeUnits: overrides.totalOverride ? overrides.totalOverride(state.calls) : text.length,
          startCodeUnit: start,
          slice
        }
      }
    };
  };
  return { run, get calls() { return state.calls; } };
}

describe("readCompleteTextVerification", () => {
  it("streams a long text from slices and digests the COMPLETE string", async () => {
    const text = `${"a".repeat(10_000)} and a tail`;
    const server = serving(text);

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: text.length });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.verification).toEqual(computeTextVerification(text));
    // More than one slice was genuinely needed.
    expect(server.calls).toBeGreaterThan(1);
  });

  it("streams an astral character split across a slice boundary, code unit for code unit", async () => {
    // Put the surrogate pair exactly on the first slice boundary.
    const text = `${"p".repeat(LAYER_TEXT_SLICE_MAX_LENGTH - 1)}🙂${"q".repeat(50)}`;
    const server = serving(text);

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: text.length });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.verification.fullDigest).toBe(computeTextVerification(text).fullDigest);
    expect(result.ok === true && result.verification.codeUnitLength).toBe(text.length);
  });

  it("fails closed when a slice read fails - never digests a partial string", async () => {
    const text = "z".repeat(LAYER_TEXT_SLICE_MAX_LENGTH * 3);
    const server = serving(text, { failAtCall: 2 });

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: text.length });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/could not read the layer's text/);
    expect(result.ok === false && result.status).toBe("CAPTURE_FAILED");
  });

  it("fails closed when the text changes length while it is being read", async () => {
    const text = "z".repeat(LAYER_TEXT_SLICE_MAX_LENGTH * 3);
    const server = serving(text, { totalOverride: (call) => (call === 1 ? text.length : text.length + 5) });

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: text.length });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/length changed while it was being read/);
  });

  it("fails closed when the text no longer matches what the project scan saw", async () => {
    const text = "z".repeat(LAYER_TEXT_SLICE_MAX_LENGTH + 10);
    const server = serving(text);

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: text.length + 1 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/changed since the project scan/);
  });

  it("fails closed when slices stop arriving before the whole text was read", async () => {
    const text = "z".repeat(LAYER_TEXT_SLICE_MAX_LENGTH * 3);
    const server = serving(text, { emptyAfter: 1 });

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: text.length });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/stopped returning content/);
  });

  it("classifies a text beyond the supported size as TOO_LARGE - terminal, never a re-inspection prompt", async () => {
    const server = serving("short", { totalOverride: () => MAX_VERIFIABLE_TEXT_CODE_UNITS + 1 });

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: MAX_VERIFIABLE_TEXT_CODE_UNITS + 1 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe("TOO_LARGE");
    expect(result.ok === false && result.codeUnitLength).toBe(MAX_VERIFIABLE_TEXT_CODE_UNITS + 1);
    // Refused before any slice was ever requested - an over-sized text costs nothing.
    expect(server.calls).toBe(0);
  });

  it("classifies a text the SCAN under-reported as TOO_LARGE once After Effects reveals its real size", async () => {
    const server = serving("short", { totalOverride: () => MAX_VERIFIABLE_TEXT_CODE_UNITS + 5 });

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: 20_000 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe("TOO_LARGE");
    expect(server.calls).toBe(1);
  });

  it("verifies a text exactly AT the supported size, streaming it without ever holding it whole", async () => {
    // Built from a repeated unit so the expectation can be computed the same
    // way without a second multi-megabyte copy lying around.
    const unit = "abcdefghij";
    const text = unit.repeat(MAX_VERIFIABLE_TEXT_CODE_UNITS / unit.length);
    expect(text.length).toBe(MAX_VERIFIABLE_TEXT_CODE_UNITS);
    const server = serving(text);

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: text.length });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.verification).toEqual(computeTextVerification(text));
    expect(result.ok === true && result.verification.codeUnitLength).toBe(MAX_VERIFIABLE_TEXT_CODE_UNITS);
  });

  it("detects a difference that occurs beyond the 2,000,000-code-unit boundary region", async () => {
    // Two texts identical for the first 1,999,990 code units, differing only
    // at the very end - the digest must still tell them apart.
    const shared = "q".repeat(MAX_VERIFIABLE_TEXT_CODE_UNITS - 10);
    const first = `${shared}AAAAAAAAAA`;
    const second = `${shared}BBBBBBBBBB`;
    const server = serving(first);

    const result = await readCompleteTextVerification(server.run, { ...TARGET, expectedCodeUnitLength: first.length });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.verification.fullDigest).toBe(computeTextVerification(first).fullDigest);
    expect(result.ok === true && result.verification.fullDigest).not.toBe(computeTextVerification(second).fullDigest);
  });

  it("rejects a malformed script result rather than trusting it", async () => {
    const run: RunSliceScript = async () => ({ ok: true, value: { resultingValue: { nonsense: true } } });

    const result = await readCompleteTextVerification(run, { ...TARGET, expectedCodeUnitLength: 10 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/did not match the expected shape/);
  });
});
