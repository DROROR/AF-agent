import type { PlaceholderType } from "@dyo/schemas";
import type { MappingEvidenceBundle } from "../mapping-evidence/types.js";

/**
 * The minimal shape classifyStructuralPlaceholder/detectKeepUnchangedIntent/
 * resolveKeepOriginal actually read - deliberately narrower than the full
 * MappingEvidenceBundle (mapping-suggestion generation's own type) so this
 * SAME structural-classification logic can also be reused from the
 * execution-plan readiness side (mapping-review-propagation fix,
 * "one authoritative current state" - never a second, duplicated notion
 * of "is this a structural no-op"). A real MappingEvidenceBundle already
 * satisfies this shape structurally, so every existing call site keeps
 * working unchanged.
 */
export interface StructuralClassificationInput {
  placeholderName: MappingEvidenceBundle["placeholderName"];
  currentClassification: MappingEvidenceBundle["currentClassification"];
  workMapEntry: MappingEvidenceBundle["workMapEntry"];
  userInstructions: MappingEvidenceBundle["userInstructions"];
}

/**
 * Mapping-review deadlock fix (client-handoff completion phase, section A/B):
 * a normal client must never be asked to Accept/Reject a structural/
 * template-helper layer (a camera, a mask, a phone-frame graphic, a shape
 * layer, a CONTROL layer, ...) when nothing actually proposes changing it.
 * These functions identify that class of target from real manifest facts
 * (the raw AE layer name already carried on the bundle) and real explicit
 * client intent (Work Map / scene instructions text) - never a guess, and
 * never at the expense of a genuine content target (Phone_screen, text,
 * logo, ...), which stays human-controlled no matter what a SIBLING
 * placeholder or the scene-level instructions say (section D/F).
 */

/**
 * A placeholder already classified (by the manifest itself, or a prior
 * human/AI decision carried forward) as one of these is a real content
 * target - it can never be reclassified as structural from a name pattern
 * alone, no matter how the layer happens to be named.
 */
const CONTENT_CLASSIFICATIONS: readonly PlaceholderType[] = ["image", "video", "text", "logo", "phone_screen"];

/**
 * Layer-name patterns that unambiguously identify a genuine content
 * target (section F) - checked BEFORE any structural pattern, so a name
 * like "Phone_screen" or "Sc_03_screen" can never be caught by a broader
 * structural rule (e.g. a bare "phone"/"frame" pattern) just because it
 * shares a word with a structural sibling layer.
 */
const CONTENT_TARGET_NAME_PATTERNS: readonly RegExp[] = [/screen/i, /display/i, /\blogo\b/i, /\btext\b/i, /\bvideo\b/i, /\bimage\b/i, /\bphoto\b/i];

/**
 * Layer-name patterns for obvious structural/template-helper elements
 * (section E's own list) - only ever consulted once a name has already
 * failed every content-target pattern above.
 */
// Deliberately NOT `\b` word boundaries for mask/matte/control/wrapper -
// real AE layer names commonly use underscores as word separators (e.g.
// "Phone_mask.png"), and `\b` treats `_` as a word character, so it would
// never actually match "_mask" as a boundary. A plain case-insensitive
// substring is safe here: every one of these already runs only after
// CONTENT_TARGET_NAME_PATTERNS has failed to match, and none of these
// words is a substring of any real content-target word above.
const STRUCTURAL_NAME_PATTERNS: readonly RegExp[] = [
  /^camera(\s|\.|\b)/i,
  /mask/i,
  /matte/i,
  /^shape\s*layer/i,
  /^control$/i,
  /control/i,
  /alpha.?helper/i,
  /^phone(\.png)?$/i,
  /phone.?comp/i,
  /wrapper/i,
  /structural/i,
  /template.?control/i
];

/** Real, explicit client language for "leave this exactly as it is" - never a guess at intent, only a match against what the client actually wrote. */
const KEEP_UNCHANGED_PHRASES: readonly RegExp[] = [
  /keep[^.]*unchanged/i,
  /leave[^.]*(as\s*is|unchanged)/i,
  /do\s*not\s*change/i,
  /don'?t\s*change/i,
  /no\s*changes?\s*needed/i,
  /unchanged/i
];

export interface StructuralClassification {
  isStructural: boolean;
  reason: string | null;
}

/**
 * Real manifest evidence only: the placeholder's own already-known
 * classification (never overridden) and its raw AE layer name (a FACT,
 * carried on the bundle since build-evidence-bundles.ts) - section E's
 * "use manifest facts... do not rely only on string matching where richer
 * manifest facts exist" is honored by checking currentClassification
 * first and only falling back to the name pattern once that is silent
 * (null/"unknown", exactly the state a real structural helper is in
 * today, since PLACEHOLDER_TYPES has no dedicated "structural" value yet).
 */
export function classifyStructuralPlaceholder(bundle: StructuralClassificationInput): StructuralClassification {
  if (bundle.currentClassification && CONTENT_CLASSIFICATIONS.includes(bundle.currentClassification)) {
    return { isStructural: false, reason: null };
  }
  const name = bundle.placeholderName;
  if (!name) {
    return { isStructural: false, reason: null };
  }
  if (CONTENT_TARGET_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return { isStructural: false, reason: null };
  }
  const matched = STRUCTURAL_NAME_PATTERNS.find((pattern) => pattern.test(name));
  if (matched) {
    return { isStructural: true, reason: `Layer name "${name}" matches a known structural/template-helper pattern - not a client content target` };
  }
  return { isStructural: false, reason: null };
}

export interface KeepUnchangedIntent {
  matched: boolean;
  reason: string | null;
}

/**
 * Explicit client language ("Keep Phone.png unchanged.", "Structural
 * phone frame comp; keep unchanged.") - real USER_INTENT, read from the
 * Work Map entry's own instructions and the scene's own stored
 * instructions (both real, human-authored text; never inferred from
 * anything else). Still gated by the caller against
 * classifyStructuralPlaceholder's content-target check (section D/F) -
 * this function only reports whether the WORDING says "unchanged"; it
 * never decides on its own whether THIS specific placeholder is allowed
 * to resolve that way.
 */
export function detectKeepUnchangedIntent(bundle: StructuralClassificationInput): KeepUnchangedIntent {
  const text = [bundle.workMapEntry?.instructions, bundle.userInstructions].filter((value): value is string => Boolean(value)).join(" ");
  if (!text) {
    return { matched: false, reason: null };
  }
  const matched = KEEP_UNCHANGED_PHRASES.some((pattern) => pattern.test(text));
  if (!matched) {
    return { matched: false, reason: null };
  }
  return { matched: true, reason: "The Work Map/scene instructions explicitly say to keep this unchanged" };
}

export interface KeepOriginalResolution {
  shouldKeepOriginal: boolean;
  reason: string | null;
}

/**
 * The single combined gate both the deterministic matcher (pre-AI) and
 * generate-mapping-suggestions.ts's AI-outcome handling (post-AI) share -
 * "client intent explicitly says keep unchanged OR manifest evidence
 * strongly identifies a structural/template helper" (section B). A
 * content target NEVER passes this gate no matter what the surrounding
 * scene's instructions say (section D/F) - classifyStructuralPlaceholder
 * itself already refuses to call a recognized content-target name
 * structural, so a scene-wide "keep wrapper unchanged" note can never
 * silently swallow a Phone_screen/text/logo placeholder here.
 */
export function resolveKeepOriginal(bundle: StructuralClassificationInput): KeepOriginalResolution {
  const structural = classifyStructuralPlaceholder(bundle);
  if (structural.isStructural) {
    const intent = detectKeepUnchangedIntent(bundle);
    return { shouldKeepOriginal: true, reason: intent.matched ? `${structural.reason}; ${intent.reason}` : structural.reason };
  }
  const intent = detectKeepUnchangedIntent(bundle);
  // A composition-level-only target (build-evidence-bundles.ts's
  // mappingId: null case - "no placeholder detected in this
  // composition") has no specific placeholder name/classification to
  // pattern-match at all, so name-based structural detection can never
  // apply to it. Real production bug: a real client Work Map entry that
  // explicitly says "this whole scene is a structural wrapper/phone-frame
  // comp - keep unchanged" was still stuck as Needs Review forever,
  // because this function unconditionally refused to resolve ANY
  // nameless bundle, no matter how explicit the Work Map was. Safe to
  // resolve here on explicit wording alone (never a bare guess) - unlike
  // the named-placeholder branch below, there is no risk of this
  // silently swallowing a REAL content placeholder, since a
  // composition-level bundle by definition has no individual content
  // field to swallow; a sibling bundle for an actual nested placeholder
  // (e.g. "Text 02" inside the same scene) is a wholly separate bundle
  // with its own real name, evaluated independently by the branch below.
  if (bundle.placeholderName === null) {
    return intent.matched ? { shouldKeepOriginal: true, reason: intent.reason } : { shouldKeepOriginal: false, reason: null };
  }
  // Not identified as structural by name/classification - an ambiguous
  // NAMED placeholder may still resolve here, but ONLY on genuinely
  // explicit client wording naming it as unchanged, never a bare
  // structural guess, and never a recognized content target.
  if (intent.matched && !isRecognizedContentTarget(bundle)) {
    return { shouldKeepOriginal: true, reason: intent.reason };
  }
  return { shouldKeepOriginal: false, reason: null };
}

export interface ProposedReplacement {
  suggestedAssetId: string | null;
  suggestedText: string | null;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Work Map conflict fix (section C): real Work Map contradiction only -
 * agreement (no replacement proposed at all, or a replacement that
 * matches what the Work Map itself asked for) is NEVER a conflict, unlike
 * the previous `workMapEntry !== null` check this replaces, which flagged
 * every AI proposal for a scene with ANY Work Map entry as a conflict
 * regardless of what either one actually said. A conflict exists only
 * when a proposal actively contradicts a real, explicit Work Map
 * instruction: a different desiredAssetId, different desiredText, or (no
 * structured field set at all) an explicit "keep unchanged" instruction
 * that the proposal nonetheless replaces.
 */
export function detectWorkMapConflict(bundle: MappingEvidenceBundle, proposal: ProposedReplacement): boolean {
  const entry = bundle.workMapEntry;
  if (!entry) {
    return false;
  }
  const proposesReplacement = proposal.suggestedAssetId !== null || (proposal.suggestedText !== null && proposal.suggestedText.trim() !== "");
  if (!proposesReplacement) {
    return false;
  }
  if (entry.desiredAssetId !== null) {
    return proposal.suggestedAssetId !== null && proposal.suggestedAssetId !== entry.desiredAssetId;
  }
  if (entry.desiredText !== null) {
    return proposal.suggestedText !== null && normalizeText(proposal.suggestedText) !== normalizeText(entry.desiredText);
  }
  return detectKeepUnchangedIntent(bundle).matched;
}

function isRecognizedContentTarget(bundle: StructuralClassificationInput): boolean {
  if (bundle.currentClassification && CONTENT_CLASSIFICATIONS.includes(bundle.currentClassification)) {
    return true;
  }
  const name = bundle.placeholderName;
  return name !== null && CONTENT_TARGET_NAME_PATTERNS.some((pattern) => pattern.test(name));
}
