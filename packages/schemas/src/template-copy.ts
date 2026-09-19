import { z } from "zod";
import { compareByVerification, computeTextVerification, foldCase, sha256Hex, stripWhitespace, type TextVerification } from "./text-digest.js";

/**
 * GENERIC LEFTOVER-TEMPLATE-COPY DETECTION (2026-09-18).
 *
 * REAL INCIDENT THIS EXISTS FOR: an approved plan shipped a complete preview
 * in which five of six visible text layers still said exactly what the
 * purchased template said ("Assets", "Free!", and their paragraphs). Nothing
 * was unmapped and nothing failed - each mapping had been prefilled with the
 * template's own wording and approved unchanged, so SET_TEXT dutifully wrote
 * each layer the words it already had. Neither mapping review nor plan
 * approval had any notion of "this text is still the template's".
 *
 * The rule is deliberately about TEXT, not about templates: a mapping is
 * compared with the untouched source layer's own text, captured during
 * template inspection. No template, layer name, composition, index or
 * language appears anywhere in this module, and the comparison is over exact
 * Unicode code points - never a normalised, folded or trimmed form (those are
 * used ONLY to recognise a near-miss, never to declare two texts equal).
 *
 * SILENCE IS NEVER APPROVAL. A text that still matches the template blocks
 * approval until a human explicitly records one of two decisions: replace it,
 * or deliberately keep the template's wording. The decision is stored on the
 * mapping with who made it, when, and the exact text it was made about, so a
 * later edit cannot silently inherit an old decision.
 *
 * A TEMPLATE TEXT TOO LONG TO STORE IS STILL VERIFIED (2026-09-19). Such a
 * text is kept as a bounded, display-only excerpt plus verification metadata
 * computed from the COMPLETE text (text-digest.ts), and this module compares
 * through those digests. Only a manifest carrying neither the text nor the
 * metadata needs re-inspection - the earlier rule asked for a re-inspection
 * that could never succeed, because re-inspecting truncates the same text
 * again.
 */

/** What a reviewer can explicitly decide about a text that still matches the template's own wording. There is deliberately no third "unset" member - the ABSENCE of a decision is represented by a null decision record, never by a value that could be defaulted. */
export const TEMPLATE_TEXT_DECISIONS = ["REPLACE", "KEEP_TEMPLATE_TEXT"] as const;
export const templateTextDecisionSchema = z.enum(TEMPLATE_TEXT_DECISIONS);
export type TemplateTextDecision = (typeof TEMPLATE_TEXT_DECISIONS)[number];

/**
 * One auditable reviewer decision, stored on the mapping itself.
 *
 * `textAtDecision` is what makes it auditable rather than merely present: it
 * records the exact text the decision was made ABOUT. If the mapping's text
 * later changes, the decision no longer describes reality and is treated as
 * stale (the mapping becomes unresolved again) rather than silently carrying
 * over - the single most likely way a "reviewed" plan could otherwise drift
 * back into shipping template copy.
 */
export const templateTextDecisionRecordSchema = z
  .object({
    decision: templateTextDecisionSchema,
    /** Who recorded it - the same user identity the plan's own approvedBy carries. */
    decidedBy: z.string().min(1),
    decidedAt: z.string().datetime(),
    /** The mapping's exact text at the moment of the decision, code point for code point. Kept for human readability of the audit record. */
    textAtDecision: z.string(),
    /**
     * The canonical digest (text-digest.ts) of the COMPLETE mapped text the
     * decision was made about. Staleness is judged by this whenever it is
     * present, so a decision can never be bound to a truncated or abbreviated
     * rendering of the text. Optional so decisions recorded before this field
     * existed still parse and still work, falling back to `textAtDecision`.
     */
    textDigestAtDecision: z.string().length(64).optional()
  })
  .strict();
export type TemplateTextDecisionRecord = z.infer<typeof templateTextDecisionRecordSchema>;

/**
 * How one mapping's text relates to the untouched template's own text.
 *
 * - `NOT_APPLICABLE` - not a text decision at all (no text on this mapping,
 *   or the placeholder is not a text layer), so there is nothing to compare.
 * - `TEMPLATE_TEXT_UNKNOWN` - the manifest carries NEITHER the template's own
 *   text NOR its verification digests, so this check cannot be performed at
 *   all. Deliberately blocking, never a warning: an unverifiable text is
 *   exactly the case the real incident shipped. A text merely too long to
 *   store is NOT this case - its digests answer every question here.
 * - `IDENTICAL` - the mapping's text equals the template's, code point for
 *   code point.
 * - `TRIVIAL_VARIANT` - it differs only in letter case, only in whitespace,
 *   or only in both. Blocking until acknowledged, because a reviewer who
 *   genuinely rewrote the line does not produce one of these by accident.
 * - `REPLACED` - genuinely different text.
 */
export const TEMPLATE_COPY_STATUSES = ["NOT_APPLICABLE", "TEMPLATE_TEXT_UNKNOWN", "IDENTICAL", "TRIVIAL_VARIANT", "REPLACED"] as const;
export const templateCopyStatusSchema = z.enum(TEMPLATE_COPY_STATUSES);
export type TemplateCopyStatus = (typeof TEMPLATE_COPY_STATUSES)[number];

/** Which kind of near-miss a TRIVIAL_VARIANT is - reported so a reviewer sees WHY it was flagged, never used to weaken the gate. */
export const TEMPLATE_COPY_VARIANT_KINDS = ["CASE", "WHITESPACE", "CASE_AND_WHITESPACE"] as const;
export type TemplateCopyVariantKind = (typeof TEMPLATE_COPY_VARIANT_KINDS)[number];

/** Whether a stored decision still describes the mapping's current text. */
export const TEMPLATE_COPY_DECISION_STATES = ["NONE", "CURRENT", "STALE"] as const;
export type TemplateCopyDecisionState = (typeof TEMPLATE_COPY_DECISION_STATES)[number];

export interface TemplateCopyInput {
  /** The mapping's own text - null when this mapping carries no text decision. */
  mappingText: string | null;
  /**
   * The untouched template layer's own text, from the manifest.
   * `undefined` means "this manifest never captured it" (a manifest built
   * before template-text capture existed, or a text too long to store in
   * full) - deliberately distinct from `null`, which means "captured, and
   * this placeholder genuinely has no text (it is not a text layer)".
   */
  templateText: string | null | undefined;
  /**
   * Digests of the COMPLETE template text, from the manifest. Used when
   * `templateText` is not stored in full (a text longer than the storage
   * bound): it keeps such a text fully verifiable instead of demanding an
   * impossible re-inspection. Ignored when the complete text is available.
   */
  templateTextVerification?: TextVerification | null;
  /** The reviewer's explicit decision, or null when none has been recorded. */
  decision: TemplateTextDecisionRecord | null;
}

export interface TemplateCopyAssessment {
  status: TemplateCopyStatus;
  variantKind: TemplateCopyVariantKind | null;
  decisionState: TemplateCopyDecisionState;
  /** The decision that actually applies (null when there is none, or when the stored one is stale). */
  effectiveDecision: TemplateTextDecision | null;
  /** True when this mapping must not pass plan approval, execution dispatch or the complete-preview gate as it stands. */
  blocks: boolean;
  /** Plain-words reason, non-null exactly when `blocks` is true - written to be shown to a human unchanged. */
  reason: string | null;
}

/**
 * Case-insensitive comparison using the SAME canonical fold the digests are
 * built from (text-digest.ts), never a second local definition - otherwise the
 * full-text path and the digest path could reach different verdicts about the
 * same pair of texts.
 */
function equalIgnoringCase(a: string, b: string): boolean {
  return foldCase(a) === foldCase(b);
}

/**
 * Pure, deterministic, dependency-free. Same inputs always give the same
 * assessment, on the API, in the dashboard, and in a test.
 */
export function assessTemplateCopy(input: TemplateCopyInput): TemplateCopyAssessment {
  const { mappingText, templateText, decision } = input;

  // Bound to the COMPLETE text's digest whenever the decision carries one, so
  // a decision is never judged current on the strength of an abbreviated
  // rendering; older records without a digest fall back to the text itself.
  const currentText = mappingText ?? "";
  const decisionState: TemplateCopyDecisionState =
    decision === null
      ? "NONE"
      : decision.textDigestAtDecision !== undefined
        ? decision.textDigestAtDecision === sha256Hex(currentText)
          ? "CURRENT"
          : "STALE"
        : decision.textAtDecision === currentText
          ? "CURRENT"
          : "STALE";
  const effectiveDecision = decisionState === "CURRENT" && decision !== null ? decision.decision : null;

  const notApplicable = (): TemplateCopyAssessment => ({
    status: "NOT_APPLICABLE",
    variantKind: null,
    decisionState,
    effectiveDecision,
    blocks: false,
    reason: null
  });

  // No text decision on this mapping at all: whether that is acceptable is
  // the ordinary mapping-resolution question (a text placeholder with no
  // decision is already unresolved there), never this gate's to answer.
  if (mappingText === null) {
    return notApplicable();
  }
  // Captured, and this placeholder is genuinely not a text layer.
  if (templateText === null) {
    return notApplicable();
  }

  const verification = input.templateTextVerification ?? null;

  // The complete text is not stored, but its verification metadata is: every
  // question this gate asks can still be answered exactly (real 2026-09-19
  // correction - demanding re-inspection here was an unresolvable loop, since
  // re-inspecting truncates the same text again).
  if (templateText === undefined && verification !== null) {
    const comparison = compareByVerification(computeTextVerification(mappingText), verification);
    if (comparison.identical) {
      const keep = effectiveDecision === "KEEP_TEMPLATE_TEXT";
      return {
        status: "IDENTICAL",
        variantKind: null,
        decisionState,
        effectiveDecision,
        blocks: !keep,
        reason: keep
          ? null
          : decisionState === "STALE"
            ? "this text is identical to the template's own wording, and the recorded decision was made about different text - decide again: replace it, or explicitly keep the template wording"
            : "this text is identical to the template's own wording - replace it, or explicitly choose to keep the template wording"
      };
    }
    if (comparison.caseOnly || comparison.whitespaceOnly || comparison.caseAndWhitespaceOnly) {
      const variantKind: TemplateCopyVariantKind = comparison.caseOnly ? "CASE" : comparison.whitespaceOnly ? "WHITESPACE" : "CASE_AND_WHITESPACE";
      const acknowledged = effectiveDecision !== null;
      const difference = variantKind === "CASE" ? "letter case" : variantKind === "WHITESPACE" ? "whitespace" : "letter case and whitespace";
      return {
        status: "TRIVIAL_VARIANT",
        variantKind,
        decisionState,
        effectiveDecision,
        blocks: !acknowledged,
        reason: acknowledged
          ? null
          : decisionState === "STALE"
            ? `this text differs from the template's own wording only in ${difference}, and the recorded decision was made about different text - decide again: replace it, or explicitly keep it`
            : `this text differs from the template's own wording only in ${difference} - replace it, or explicitly confirm you meant it`
      };
    }
    return { status: "REPLACED", variantKind: null, decisionState, effectiveDecision, blocks: false, reason: null };
  }

  if (templateText === undefined) {
    return {
      status: "TEMPLATE_TEXT_UNKNOWN",
      variantKind: null,
      decisionState,
      effectiveDecision,
      blocks: true,
      reason:
        "this project's manifest records neither the template's own text for this layer nor its verification digests, so it cannot be checked for leftover template copy - re-run template inspection for this project before approving or executing",
    };
  }

  // EXACT comparison, code point for code point. Case folding and whitespace
  // stripping below are only ever used to RECOGNISE a near-miss.
  if (mappingText === templateText) {
    const keep = effectiveDecision === "KEEP_TEMPLATE_TEXT";
    return {
      status: "IDENTICAL",
      variantKind: null,
      decisionState,
      effectiveDecision,
      blocks: !keep,
      reason: keep
        ? null
        : decisionState === "STALE"
          ? "this text is identical to the template's own wording, and the recorded decision was made about different text - decide again: replace it, or explicitly keep the template wording"
          : "this text is identical to the template's own wording - replace it, or explicitly choose to keep the template wording"
    };
  }

  const sameIgnoringCase = equalIgnoringCase(mappingText, templateText);
  const sameIgnoringWhitespace = stripWhitespace(mappingText) === stripWhitespace(templateText);
  const sameIgnoringBoth = equalIgnoringCase(stripWhitespace(mappingText), stripWhitespace(templateText));

  if (sameIgnoringCase || sameIgnoringWhitespace || sameIgnoringBoth) {
    const variantKind: TemplateCopyVariantKind = sameIgnoringCase ? "CASE" : sameIgnoringWhitespace ? "WHITESPACE" : "CASE_AND_WHITESPACE";
    const acknowledged = effectiveDecision !== null;
    const difference = variantKind === "CASE" ? "letter case" : variantKind === "WHITESPACE" ? "whitespace" : "letter case and whitespace";
    return {
      status: "TRIVIAL_VARIANT",
      variantKind,
      decisionState,
      effectiveDecision,
      blocks: !acknowledged,
      reason: acknowledged
        ? null
        : decisionState === "STALE"
          ? `this text differs from the template's own wording only in ${difference}, and the recorded decision was made about different text - decide again: replace it, or explicitly keep it`
          : `this text differs from the template's own wording only in ${difference} - replace it, or explicitly confirm you meant it`
    };
  }

  return {
    status: "REPLACED",
    variantKind: null,
    decisionState,
    effectiveDecision,
    blocks: false,
    reason: null
  };
}
