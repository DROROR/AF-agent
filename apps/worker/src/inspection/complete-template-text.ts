import { MAX_VERIFIABLE_TEXT_CODE_UNITS, TextVerificationStream, type TextCaptureStatus, type TextVerification } from "@dyo/schemas";
import { buildReadLayerTextSliceScript, LAYER_TEXT_SLICE_MAX_LENGTH, type FixedJsxScript } from "../execution/jsx-templates.js";

/**
 * COMPLETE-TEXT VERIFICATION FOR LONG TEMPLATE TEXT (2026-09-19).
 *
 * The project-wide scan carries at most a bounded excerpt of each text layer,
 * for payload safety. A text longer than that bound used to be marked
 * "truncated" and treated as unverifiable, which blocked approval with
 * "re-run template inspection" - advice that could never work, since
 * re-inspecting truncates the same text again.
 *
 * This module closes that loop: for exactly those layers, it reads the text in
 * bounded slices and STREAMS each slice straight into the canonical digests
 * (text-digest.ts), never assembling the complete string in memory. Both
 * canonical normalizations are context-free, and a surrogate pair split across
 * a slice boundary is carried over inside the stream, so the digests are
 * identical however the text happens to be sliced.
 *
 * WHAT IT REPORTS, and why the distinction matters: a transient read failure
 * (`CAPTURE_FAILED`) is worth re-inspecting for, while a text beyond
 * MAX_VERIFIABLE_TEXT_CODE_UNITS (`TOO_LARGE`) never will be - reporting that
 * as "re-run inspection" would be an endless loop, so it is reported as its
 * own terminal state instead.
 *
 * Read-only by construction: the only script it runs is
 * buildReadLayerTextSliceScript, which reads `sourceText.value.text` and
 * nothing else.
 */

export type RunSliceScript = (script: FixedJsxScript) => Promise<{ ok: true; value: unknown } | { ok: false; reason: string }>;

export interface LongTextTarget {
  aeProjectItemIndex: number;
  compositionName: string;
  layerIndex: number;
  /** What the scan reported as the complete text's own code-unit length. */
  expectedCodeUnitLength: number;
}

export type CompleteTextResult =
  | { ok: true; verification: TextVerification }
  | { ok: false; status: Extract<TextCaptureStatus, "CAPTURE_FAILED" | "TOO_LARGE">; codeUnitLength: number | null; reason: string };

/** What buildReadLayerTextSliceScript's own resultingValue contains - parsed defensively, never trusted blindly. */
function parseSlice(value: unknown): { totalCodeUnits: number; startCodeUnit: number; slice: string } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as { resultingValue?: unknown };
  const inner = (candidate.resultingValue ?? value) as { totalCodeUnits?: unknown; startCodeUnit?: unknown; slice?: unknown };
  if (typeof inner.totalCodeUnits !== "number" || typeof inner.startCodeUnit !== "number" || typeof inner.slice !== "string") {
    return null;
  }
  return { totalCodeUnits: inner.totalCodeUnits, startCodeUnit: inner.startCodeUnit, slice: inner.slice };
}

function failed(reason: string, codeUnitLength: number | null = null): CompleteTextResult {
  return { ok: false, status: "CAPTURE_FAILED", codeUnitLength, reason };
}

/**
 * Reads one layer's complete text in slices, streaming them into the canonical
 * digests. Fails closed - never returns a digest of a partial text - if a
 * slice fails, the streamed length disagrees with what After Effects reports,
 * or the text is beyond the supported size (reported as TOO_LARGE, which is
 * terminal rather than a re-inspection prompt).
 */
export async function readCompleteTextVerification(runScript: RunSliceScript, target: LongTextTarget): Promise<CompleteTextResult> {
  if (target.expectedCodeUnitLength > MAX_VERIFIABLE_TEXT_CODE_UNITS) {
    return {
      ok: false,
      status: "TOO_LARGE",
      codeUnitLength: target.expectedCodeUnitLength,
      reason: `the layer's text is ${target.expectedCodeUnitLength} code units, beyond the ${MAX_VERIFIABLE_TEXT_CODE_UNITS} this system verifies`
    };
  }

  const stream = new TextVerificationStream();
  let streamedCodeUnits = 0;
  let reportedTotal: number | null = null;
  let guard = 0;
  const maxCalls = Math.ceil(MAX_VERIFIABLE_TEXT_CODE_UNITS / LAYER_TEXT_SLICE_MAX_LENGTH) + 2;

  for (;;) {
    guard += 1;
    if (guard > maxCalls) {
      return failed("slice reading did not terminate within its own bound", reportedTotal);
    }

    const script = buildReadLayerTextSliceScript(
      target.aeProjectItemIndex,
      target.compositionName,
      target.layerIndex,
      streamedCodeUnits,
      LAYER_TEXT_SLICE_MAX_LENGTH
    );
    const result = await runScript(script);
    if (!result.ok) {
      return failed(`could not read the layer's text: ${result.reason}`, reportedTotal);
    }
    const slice = parseSlice(result.value);
    if (!slice) {
      return failed("the text-slice script's own result did not match the expected shape", reportedTotal);
    }
    if (reportedTotal === null) {
      reportedTotal = slice.totalCodeUnits;
      if (reportedTotal > MAX_VERIFIABLE_TEXT_CODE_UNITS) {
        return {
          ok: false,
          status: "TOO_LARGE",
          codeUnitLength: reportedTotal,
          reason: `the layer's text is ${reportedTotal} code units, beyond the ${MAX_VERIFIABLE_TEXT_CODE_UNITS} this system verifies`
        };
      }
    } else if (slice.totalCodeUnits !== reportedTotal) {
      // The project is expected to be untouched for the whole inspection; a
      // changing length means it is not, so nothing read here can be trusted.
      return failed("the layer's text length changed while it was being read", reportedTotal);
    }
    if (slice.startCodeUnit !== streamedCodeUnits) {
      return failed("the text-slice script returned a slice from an unexpected offset", reportedTotal);
    }

    stream.update(slice.slice);
    streamedCodeUnits += slice.slice.length;
    if (streamedCodeUnits >= reportedTotal) {
      break;
    }
    if (slice.slice.length === 0) {
      return failed("the text-slice script stopped returning content before the whole text was read", reportedTotal);
    }
  }

  if (streamedCodeUnits !== reportedTotal) {
    return failed(`read ${streamedCodeUnits} code units but After Effects reports ${reportedTotal}`, reportedTotal);
  }
  if (streamedCodeUnits !== target.expectedCodeUnitLength) {
    return failed(`the layer's text length changed since the project scan (scan saw ${target.expectedCodeUnitLength}, read ${streamedCodeUnits})`, reportedTotal);
  }

  return { ok: true, verification: stream.finish() };
}
