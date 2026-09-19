import { computeTextVerification, type TextVerification } from "@dyo/schemas";
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
 * bounded slices, reassembles it IN ORDER, verifies the reassembly against the
 * length After Effects itself reports, and computes the canonical digests from
 * the COMPLETE string. The manifest then carries a display-only excerpt plus
 * metadata that answers every question the gate asks.
 *
 * Read-only by construction: the only script it runs is
 * buildReadLayerTextSliceScript, which reads `sourceText.value.text` and
 * nothing else.
 */

/** Refuses to assemble beyond this many code units for one layer. A template text this long is pathological; failing closed here is honest, and the gate then treats the layer as unverifiable rather than guessing. */
export const MAX_ASSEMBLED_TEXT_CODE_UNITS = 2_000_000;

export type RunSliceScript = (script: FixedJsxScript) => Promise<{ ok: true; value: unknown } | { ok: false; reason: string }>;

export interface LongTextTarget {
  aeProjectItemIndex: number;
  compositionName: string;
  layerIndex: number;
  /** What the scan reported as the complete text's own code-unit length. */
  expectedCodeUnitLength: number;
}

export type CompleteTextResult = { ok: true; verification: TextVerification } | { ok: false; reason: string };

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

/**
 * Reads one layer's complete text in slices and returns its canonical
 * verification metadata. Fails closed - never returns a digest of a partial
 * string - if a slice fails, the assembled length disagrees with what After
 * Effects reports, or the text exceeds MAX_ASSEMBLED_TEXT_CODE_UNITS.
 */
export async function readCompleteTextVerification(runScript: RunSliceScript, target: LongTextTarget): Promise<CompleteTextResult> {
  let assembled = "";
  let reportedTotal: number | null = null;
  let guard = 0;

  while (true) {
    guard += 1;
    if (guard > Math.ceil(MAX_ASSEMBLED_TEXT_CODE_UNITS / LAYER_TEXT_SLICE_MAX_LENGTH) + 2) {
      return { ok: false, reason: "slice reading did not terminate within its own bound" };
    }

    const script = buildReadLayerTextSliceScript(
      target.aeProjectItemIndex,
      target.compositionName,
      target.layerIndex,
      assembled.length,
      LAYER_TEXT_SLICE_MAX_LENGTH
    );
    const result = await runScript(script);
    if (!result.ok) {
      return { ok: false, reason: `could not read the layer's text: ${result.reason}` };
    }
    const slice = parseSlice(result.value);
    if (!slice) {
      return { ok: false, reason: "the text-slice script's own result did not match the expected shape" };
    }
    if (reportedTotal === null) {
      reportedTotal = slice.totalCodeUnits;
      if (reportedTotal > MAX_ASSEMBLED_TEXT_CODE_UNITS) {
        return { ok: false, reason: `the layer's text is ${reportedTotal} code units, beyond the ${MAX_ASSEMBLED_TEXT_CODE_UNITS} this worker will assemble` };
      }
    } else if (slice.totalCodeUnits !== reportedTotal) {
      // The project is expected to be untouched for the whole inspection; a
      // changing length means it is not, so nothing read here can be trusted.
      return { ok: false, reason: "the layer's text length changed while it was being read" };
    }
    if (slice.startCodeUnit !== assembled.length) {
      return { ok: false, reason: "the text-slice script returned a slice from an unexpected offset" };
    }

    assembled += slice.slice;
    if (assembled.length >= reportedTotal) {
      break;
    }
    if (slice.slice.length === 0) {
      return { ok: false, reason: "the text-slice script stopped returning content before the whole text was read" };
    }
  }

  if (assembled.length !== reportedTotal) {
    return { ok: false, reason: `assembled ${assembled.length} code units but After Effects reports ${reportedTotal}` };
  }
  if (assembled.length !== target.expectedCodeUnitLength) {
    return { ok: false, reason: `the layer's text length changed since the project scan (scan saw ${target.expectedCodeUnitLength}, read ${assembled.length})` };
  }

  return { ok: true, verification: computeTextVerification(assembled) };
}
