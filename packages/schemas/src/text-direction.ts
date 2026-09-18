import { z } from "zod";

/**
 * GENERIC BIDIRECTIONAL TEXT SUPPORT (2026-09-18).
 *
 * A replaced text line's writing direction is a property of the TEXT, not of
 * the template it lands in: the same Hebrew or Arabic line needs
 * right-to-left paragraph direction and a Middle-Eastern-capable composer
 * whatever project it is written into. This module derives that requirement
 * from Unicode alone - never from a layer/composition name, a template, a
 * language setting, or an operator's say-so.
 *
 * BASE DIRECTION IS FIRST-STRONG, the rule the Unicode Bidirectional
 * Algorithm itself uses to choose a paragraph's base direction (UAX #9, rules
 * P2/P3): scan for the FIRST strongly-directional character and take its
 * direction. So a Hebrew-first line that ends in Latin ("מבית DYO App") is a
 * right-to-left paragraph, while an English-first line that contains Hebrew
 * ("DYO App מבית") is a left-to-right one - which is exactly how each reads
 * when set correctly. Leading digits, punctuation, quotes or whitespace are
 * not strong, so they never decide the base direction; text with no strong
 * character at all is NEUTRAL and the template's own settings are preserved.
 *
 * WHAT IT DELIBERATELY NEVER DOES: reorder, mirror, reverse or otherwise
 * rewrite the characters. Visual ordering is After Effects' own bidi
 * algorithm's job once the paragraph direction and composer are correct.
 * Reversing code points produces text that merely LOOKS right in one
 * rendering and is wrong in every other (search, copy, screen readers, and
 * any line that mixes scripts), which is exactly the failure this project's
 * own live-QA correction calls out ("do NOT rely on visual RTL rendering").
 * The exact stored code points are therefore always the caller's own string,
 * byte for byte, and `expectedCodeUnits` exists so a mutation can PROVE that
 * after writing.
 */

/** A paragraph direction requirement derived from the text itself. NEUTRAL means the text contains no strongly-directional character at all (digits, punctuation, symbols, whitespace), so nothing about it justifies changing the template's own direction. */
export const TEXT_DIRECTIONS = ["RTL", "LTR", "NEUTRAL"] as const;
export const textDirectionSchema = z.enum(TEXT_DIRECTIONS);
export type TextDirection = (typeof TEXT_DIRECTIONS)[number];

/**
 * Unicode scripts whose natural writing direction is right-to-left.
 *
 * Kept as script NAMES matched through `Script_Extensions`, not as hardcoded
 * code-point ranges: a range list silently rots as Unicode grows (Adlam and
 * Hanifi Rohingya are both younger than plenty of shipped range tables),
 * while `Script_Extensions` also correctly attributes shared punctuation and
 * combining marks to the script actually using them. Any name the running
 * engine does not know is skipped rather than throwing, so this module works
 * unchanged on an older ICU build - see `compileRtlPattern`.
 */
export const RTL_SCRIPT_NAMES = [
  "Adlam",
  "Arabic",
  "Hanifi_Rohingya",
  "Hebrew",
  "Kharoshthi",
  "Mandaic",
  "Mende_Kikakui",
  "Nko",
  "Old_Hungarian",
  "Samaritan",
  "Syriac",
  "Thaana",
  "Yezidi"
] as const;

/** One script's own matcher, or null when the running engine does not recognise the name. Built once at module load; a `\p{Script_Extensions=...}` with an unknown value is a SyntaxError at construction, never a silent no-match. */
function compileScriptPattern(scriptName: string): RegExp | null {
  try {
    return new RegExp(`\\p{Script_Extensions=${scriptName}}`, "u");
  } catch {
    return null;
  }
}

const RTL_SCRIPT_MATCHERS: readonly { readonly script: string; readonly pattern: RegExp }[] = RTL_SCRIPT_NAMES.flatMap((script) => {
  const pattern = compileScriptPattern(script);
  return pattern === null ? [] : [{ script: script as string, pattern }];
});

/** Every recognised RTL script in one alternation - used for the per-character scan. */
const ANY_RTL_PATTERN = RTL_SCRIPT_MATCHERS.length > 0 ? new RegExp(RTL_SCRIPT_MATCHERS.map((entry) => entry.pattern.source).join("|"), "u") : null;

/**
 * A strongly LEFT-to-right character: any letter that is not itself from an
 * RTL script. Deliberately derived by subtraction rather than from a list of
 * LTR scripts, so Latin, Cyrillic, Greek, Han, Devanagari and every script
 * this project has never seen all count without an enumeration to maintain.
 */
const LETTER_PATTERN = /\p{L}/u;

export interface TextDirectionAnalysis {
  /**
   * The paragraph's base direction, taken from its FIRST strongly-directional
   * character (UAX #9 P2/P3): RTL for a Hebrew/Arabic-first line even when it
   * ends in Latin, LTR for a Latin-first line even when it contains Hebrew,
   * NEUTRAL when no strong character occurs at all (then nothing about the
   * text justifies changing the template's own direction).
   */
  requiredDirection: TextDirection;
  /** True when ANY right-to-left character occurs anywhere, whatever the base direction is - this, not `requiredDirection`, is what decides whether a Middle-Eastern-capable composer is required to shape the text at all. */
  hasRtl: boolean;
  hasStrongLtr: boolean;
  /**
   * True when the text cannot be rendered correctly by a plain left-to-right
   * Latin composer: any right-to-left character is present, so BOTH the base
   * direction and the Middle-Eastern-capable composer engine must be applied
   * and verified, and the mutation fails closed if they cannot be.
   */
  requiresBidiHandling: boolean;
  /** True when BOTH directions occur - the case that makes correct bidi handling (rather than reordering) unavoidable. */
  isMixed: boolean;
  /** Which RTL scripts actually occur, in the order this module checks them - evidence, never a decision input beyond `hasRtl`. */
  rtlScripts: readonly string[];
  rtlCharacterCount: number;
  strongLtrCharacterCount: number;
  /** UTF-16 code units, i.e. what After Effects' own `String.length`/`charCodeAt` see - the sequence a mutation verifies after writing. */
  codeUnitCount: number;
  /** Code points, which differ from `codeUnitCount` for anything outside the BMP (emoji, historic RTL scripts like Mende Kikakui). */
  codePointCount: number;
}

/**
 * Pure, deterministic Unicode analysis. No I/O, no AE, no template
 * knowledge, no language guessing, and no mutation of the input.
 */
export function analyseTextDirection(text: string): TextDirectionAnalysis {
  const rtlScripts: string[] = [];
  let rtlCharacterCount = 0;
  let strongLtrCharacterCount = 0;
  /** The direction of the first strongly-directional character - UAX #9's own P2/P3 base-direction rule. */
  let firstStrongDirection: TextDirection = "NEUTRAL";

  for (const character of text) {
    const isRtl = ANY_RTL_PATTERN !== null && ANY_RTL_PATTERN.test(character);
    if (isRtl) {
      rtlCharacterCount += 1;
      if (firstStrongDirection === "NEUTRAL") {
        firstStrongDirection = "RTL";
      }
      for (const entry of RTL_SCRIPT_MATCHERS) {
        if (entry.pattern.test(character) && !rtlScripts.includes(entry.script)) {
          rtlScripts.push(entry.script);
        }
      }
      continue;
    }
    if (LETTER_PATTERN.test(character)) {
      strongLtrCharacterCount += 1;
      if (firstStrongDirection === "NEUTRAL") {
        firstStrongDirection = "LTR";
      }
    }
  }

  const hasRtl = rtlCharacterCount > 0;
  const hasStrongLtr = strongLtrCharacterCount > 0;
  return {
    requiredDirection: firstStrongDirection,
    hasRtl,
    hasStrongLtr,
    requiresBidiHandling: hasRtl,
    isMixed: hasRtl && hasStrongLtr,
    rtlScripts,
    rtlCharacterCount,
    strongLtrCharacterCount,
    codeUnitCount: text.length,
    codePointCount: [...text].length
  };
}

/** The exact UTF-16 code-unit sequence a mutation must find in the project after writing `text`. Never a hash: a mismatch should be able to say WHERE it differs. */
export function textCodeUnits(text: string): number[] {
  const units: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    units.push(text.charCodeAt(index));
  }
  return units;
}

/**
 * What a SET_TEXT mutation reports back about direction handling, so an
 * operator can see - per operation, in the job's own evidence - what was
 * required, what After Effects actually applied, and how that was verified.
 * Every field is a real read-back from the project, never an assumption that
 * an assignment took effect.
 */
export const textDirectionEvidenceSchema = z
  .object({
    /** The base direction taken from the text's first strong character (UAX #9 P2/P3). */
    requiredDirection: textDirectionSchema,
    rtlScripts: z.array(z.string()).default([]),
    isMixed: z.boolean(),
    /** True when the text contains any right-to-left character, so direction and composer had to be applied and verified rather than left to the template. Defaulted for records written before this field existed. */
    requiresBidiHandling: z.boolean().default(false),
    /** The layer's own direction before this mutation, as AE reported it; null when this AE build does not expose paragraph direction at all. */
    previousDirection: z.string().nullable(),
    previousComposerEngine: z.string().nullable(),
    /** What this mutation set, or null when it deliberately left the template's own value alone (LTR/NEUTRAL text never overrides a template's typography). */
    appliedDirection: z.string().nullable(),
    appliedComposerEngine: z.string().nullable(),
    /** Read back from the project AFTER the write. False for RTL text fails the operation closed - it is never reported as a successful edit. */
    directionVerified: z.boolean(),
    composerVerified: z.boolean(),
    /** The stored text's code-unit sequence was compared with the requested one, position by position. */
    textCodeUnitsVerified: z.boolean(),
    codeUnitCount: z.number().int().nonnegative(),
    /** Plain-words note when AE could not report something (e.g. an older build without a composer-engine API) - present even on success, so a degraded-but-accepted path is never invisible. */
    note: z.string().nullable().default(null)
  })
  .strict();
export type TextDirectionEvidence = z.infer<typeof textDirectionEvidenceSchema>;
