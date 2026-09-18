import { analyseTextDirection, textCodeUnits } from "@dyo/schemas";
import type { ResolvedNestedTargetStep, SceneEditOperation } from "@dyo/schemas";

/**
 * The ONE and ONLY source of JSX/ExtendScript text this worker will ever
 * send to After Effects (CLAUDE.md Safety Rule 2: "never execute arbitrary
 * AI-generated JSX ... only tested, versioned, allowlisted scripts").
 *
 * `FixedJsxScript` is a nominally-branded string type: nothing outside
 * this file can construct one (there is no public way to produce the
 * brand from a plain string), so `HeroicSwanAeMutationClient.runFixedOperation`
 * (the only consumer of this type) can never be called with an arbitrary
 * string by construction - not by convention, by the type checker. Every
 * builder below takes only the already-Zod-validated fields of one
 * `SceneEditOperation` variant; there is no free-form property path, no
 * user-supplied JSX fragment, and no string concatenation of untrusted
 * text into a JSX control position - every interpolated value is either a
 * validated number or passed through `JSON.stringify` (which produces a
 * safely-escaped ExtendScript string literal for any JS string value).
 *
 * Every script:
 *   - wraps its single mutation in `app.beginUndoGroup`/`try`/`finally`/
 *     `app.endUndoGroup` (Safety Rule 3),
 *   - resolves the target composition by `aeProjectItemIndex` via a direct
 *     `app.project.item(idx)` lookup - the SAME raw, 1-based-across-ALL-
 *     project-items convention `ae_get_composition`/`ae_get_layer`'s own
 *     `comp_index` argument uses (confirmed 2026-08-27 directly from the
 *     real upstream host-scripts/ae-mcp-methods.jsx's own `resolveComp`:
 *     `app.project.item(idx)` then an `instanceof CompItem` check - NOT a
 *     0-based "count only CompItems encountered" scan, which is what this
 *     file mistakenly did until this pass. See PRE-WINDOWS FINAL EXECUTION
 *     HARDENING's canonical-composition-addressing section for the full
 *     trace),
 *   - verifies the resolved CompItem's own `.name` matches the expected
 *     `compositionName` BEFORE any mutation is attempted - a typed
 *     precondition failure, never a guess, if a stale/wrong
 *     aeProjectItemIndex resolves to a different composition that merely
 *     happens to occupy that project-item slot right now,
 *   - and the target layer ONLY by `layer(layerIndex)` (AE's own native
 *     1-based layer index) - never by name, never by a nested search of
 *     arbitrary depth,
 *   - validates the target layer's actual capability (e.g. "is this a
 *     TextLayer", "does this layer support time remapping") BEFORE
 *     attempting any mutation, returning a typed `{ok:false,
 *     failureReason}` instead of a partial/guessed mutation when it is
 *     not,
 *   - is a bare FUNCTION BODY (no outer `(function(){...})()`), ending in
 *     a top-level `return` of one JSON string shaped as `{ok, previousValue,
 *     resultingValue, failureReason}` - the contract `ae-edit-bridge.ts`
 *     parses. This is not stylistic: the real upstream `ae_run_jsx` tool
 *     executes `code` via `new Function("args", code)` and uses the
 *     resulting function's OWN return value - wrapping in a self-invoking
 *     expression would make the outer (host-constructed) function return
 *     `undefined`, silently discarding this script's actual result (this
 *     exact bug existed here until it was caught and fixed on 2026-08-27
 *     by reading the real host-scripts/ae-mcp-methods.jsx dispatch case).
 *
 * VERIFIED (2026-08-27) directly from the real upstream source - not
 * assumed: `ae_run_jsx`'s real registration (tools/index.ts) takes
 * `{code: string, args?: Record<string,unknown>, mode?: "restricted"|"unsafe", description?: string}`,
 * and its `mode` MUST be `"unsafe"` - upstream's own comment reads
 * "restricted mode not yet allowlisting scripts", so passing anything
 * else always errors. This makes `ae_run_jsx` a genuinely unrestricted,
 * arbitrary-JSX escape hatch with NO enforcement of its own - the
 * `FixedJsxScript` brand in this file is the entire safety boundary; see
 * heroic-swan-ae-mutation-client.ts for how the call is actually shaped,
 * and ae-edit-bridge.ts for how the (double-JSON-wrapped - the host
 * itself wraps this script's own JSON.stringify'd return value in a
 * `{result: ...}` envelope before the MCP text block wraps THAT) response
 * is parsed.
 */
declare const fixedJsxScriptBrand: unique symbol;
export type FixedJsxScript = string & { readonly [fixedJsxScriptBrand]: true };

/**
 * REAL PRODUCTION BUG (2026-09-02): every script in this file calls
 * `JSON.stringify(...)` assuming a real JS `JSON` global is present at
 * ExtendScript runtime. Adobe's ExtendScript engine (the actual JS engine
 * After Effects executes this code in) predates JSON becoming a standard
 * JS-engine builtin and does NOT polyfill it by default - this is a
 * well-documented ExtendScript gotcha (the reason `#include "json2.js"`
 * exists in the wild). INSPECT_RENDER_CAPABILITIES was the first of these
 * scripts to actually run against a real AE installation (every other
 * script here is either not yet a live capability or had not been
 * exercised on real Windows/AE yet), and failed immediately with a bare
 * `ReferenceError: JSON is undefined` - every other script sharing this
 * exact pattern carries the identical latent bug, fixed once here for
 * all of them.
 *
 * Prepended to the START of every script this file builds (before
 * `app.beginUndoGroup`, so it never affects what is/isn't undoable):
 * installs a small, fixed, fully-reviewed `JSON.stringify`-only shim,
 * ONLY if a real one is not already present (defensive - never
 * overwrites/shadows a working native implementation on an AE/
 * ExtendScript version that does have one). Handles exactly the value
 * shapes these scripts ever produce - plain objects, arrays, strings,
 * numbers, booleans, null - not a full JSON spec implementation (no
 * Date/circular-reference handling), since none of these scripts ever
 * serialize anything else. Built with `String.raw` so every backslash/
 * quote below is exactly what ends up in the generated ExtendScript
 * source text - never subject to this TypeScript file's own string-
 * escaping rules.
 */
const JSON_STRINGIFY_POLYFILL = String.raw`if (typeof JSON === "undefined") { JSON = {}; }
  if (typeof JSON.stringify !== "function") {
    var __dyoJsonQuoteString = function (__s) {
      var __out = "\"";
      for (var __qi = 0; __qi < __s.length; __qi++) {
        var __qc = __s.charAt(__qi);
        var __qcode = __s.charCodeAt(__qi);
        if (__qc === "\"" || __qc === "\\") {
          __out += "\\" + __qc;
        } else if (__qc === "\n") {
          __out += "\\n";
        } else if (__qc === "\r") {
          __out += "\\r";
        } else if (__qc === "\t") {
          __out += "\\t";
        } else if (__qcode < 0x20) {
          __out += "\\u" + ("0000" + __qcode.toString(16)).slice(-4);
        } else {
          __out += __qc;
        }
      }
      return __out + "\"";
    };
    JSON.stringify = function __dyoJsonStringify(__value) {
      if (__value === null || __value === undefined) { return "null"; }
      var __type = typeof __value;
      if (__type === "number") { return isFinite(__value) ? String(__value) : "null"; }
      if (__type === "boolean") { return __value ? "true" : "false"; }
      if (__type === "string") { return __dyoJsonQuoteString(__value); }
      if (__value instanceof Array) {
        var __items = [];
        for (var __ai = 0; __ai < __value.length; __ai++) {
          __items.push(JSON.stringify(__value[__ai]));
        }
        return "[" + __items.join(",") + "]";
      }
      if (__type === "object") {
        var __parts = [];
        for (var __key in __value) {
          if (!__value.hasOwnProperty(__key)) { continue; }
          __parts.push(__dyoJsonQuoteString(__key) + ":" + JSON.stringify(__value[__key]));
        }
        return "{" + __parts.join(",") + "}";
      }
      return "null";
    };
  }
  `;

/**
 * NEVER wraps this in `(function () { ... })()` - the real upstream
 * `ae_run_jsx` tool (verified 2026-08-27 directly from the real upstream
 * source: tools/index.ts's `ae_run_jsx` registration and
 * host-scripts/ae-mcp-methods.jsx's `system.runJsx` dispatch case) executes
 * `code` as a FUNCTION BODY via `new Function("args", code)`, then calls
 * the resulting function and uses ITS return value - so this text must be
 * plain statements ending in a top-level `return`, never a self-invoking
 * expression whose own return value the outer (host-constructed) function
 * would silently discard.
 */
function wrapScript(operationLabel: string, body: string): FixedJsxScript {
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify(`DYO EXECUTE_FRAME: ${operationLabel}`)});
  var __result = null;
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(__TARGET_COMP_INDEX__);
      if (__rawItem instanceof CompItem) {
        __comp = __rawItem;
      }
    } catch (__compLookupError) {
      __comp = null;
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + __TARGET_COMP_INDEX__ + " did not resolve to a composition in this project" });
    } else if (__comp.name !== __EXPECTED_COMP_NAME__) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "project item index " + __TARGET_COMP_INDEX__ + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + __EXPECTED_COMP_NAME__ + "\\" - refusing to mutate the wrong composition"
      });
    } else {
      var __layer = null;
      try {
        __layer = __comp.layer(__TARGET_LAYER_INDEX__);
      } catch (__layerLookupError) {
        __layer = null;
      }
      if (__layer === null) {
        __result = JSON.stringify({ ok: false, failureReason: "layer index " + __TARGET_LAYER_INDEX__ + " was not found in the target composition" });
      } else {
        ${body}
      }
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/** Substitutes the placeholders every wrapped script shares - kept as one helper so every builder interpolates aeProjectItemIndex/compositionName/layerIndex identically. `compositionName` is JSON.stringify'd like every other untrusted-text interpolation in this file (module doc comment). */
function withTargets(script: string, aeProjectItemIndex: number, compositionName: string, layerIndex: number): string {
  return script
    .replaceAll("__TARGET_COMP_INDEX__", String(aeProjectItemIndex))
    .replaceAll("__EXPECTED_COMP_NAME__", JSON.stringify(compositionName))
    .replaceAll("__TARGET_LAYER_INDEX__", String(layerIndex));
}

/**
 * Runs a mutation body with the target layer temporarily unlocked.
 *
 * REAL 2026-09-14 FAILURE (job 8873bf84, operation 7): a template shipped its
 * screen-card layer LOCKED, and After Effects refused the edit ("Can not call
 * method moveToBeginning ... because the Layer is locked"). A designer's lock
 * protects a layer from accidental manual changes, not from an approved,
 * explicit edit - so the layer is unlocked only for this operation and locked
 * again afterwards, preserving the template's own lock state. If the lock
 * cannot be restored, the operation is reported as failed rather than
 * silently leaving the layer unlocked.
 */
function withTargetLayerUnlocked(body: string): string {
  return `
        var __wasLayerLocked = false;
        try { __wasLayerLocked = __layer.locked === true; } catch (__lockReadError) { __wasLayerLocked = false; }
        if (__wasLayerLocked) { __layer.locked = false; }
        try {${body}
        } finally {
          if (__wasLayerLocked) {
            try {
              __layer.locked = true;
            } catch (__relockError) {
              __result = JSON.stringify({ ok: false, failureReason: "the edit ran, but the layer's original lock could not be restored: " + (__relockError && __relockError.toString ? __relockError.toString() : String(__relockError)) });
            }
          }
        }`;
}

/** Shared mutation body for SET_TEXT - identical for the flat and nested target cases, since both resolve down to the same `__layer` variable before this runs. */
function buildSetTextBody(text: string): string {
  return withTargetLayerUnlocked(buildSetTextMutation(text));
}

/** A replaced text line is never shrunk below this fraction of its template scale - below it the operation fails instead of producing unreadably small text. */
export const TEXT_AUTO_FIT_MIN_FACTOR = 0.6;

/**
 * BIDIRECTIONAL TEXT (2026-09-18, generic - no template, language or layer
 * name is ever consulted).
 *
 * `analyseTextDirection` derives from Unicode alone (a) whether the
 * REPLACEMENT text contains any right-to-left character and (b) its base
 * direction, from the first strongly-directional character - UAX #9's own
 * P2/P3 rule. When any right-to-left character is present, this mutation sets
 * that base direction (right-to-left for a Hebrew-first line, left-to-right
 * for a Latin-first line that merely contains Hebrew) AND a
 * Middle-Eastern-capable composer engine on the same TextDocument as the text
 * itself, BEFORE the auto-fit measures anything - both properties change the
 * rendered rect, so fitting first would fit the wrong shape.
 *
 * FAILS CLOSED, NEVER "WARNS AND SUCCEEDS". If the text contains
 * right-to-left characters and this After Effects build exposes no
 * ParagraphDirection/ComposerEngine, or an assignment throws, or the
 * read-back does not show the requested values, the operation FAILS. Text
 * with no right-to-left character at all never overrides the template's own
 * typography, so nothing is assigned and nothing can fail.
 *
 * The characters themselves are never reordered, mirrored or reversed: the
 * exact code units are written, then read back and compared position by
 * position, and any difference fails the operation (see text-direction.ts).
 */
function buildSetTextMutation(text: string): string {
  const textLiteral = JSON.stringify(text);
  const analysis = analyseTextDirection(text);
  const expectedCodeUnits = JSON.stringify(textCodeUnits(text));
  // Any right-to-left character means a plain Latin composer cannot shape
  // this text correctly, whichever way the paragraph itself reads.
  const requiresBidi = analysis.requiresBidiHandling;
  const wantedDirectionMember = analysis.requiredDirection === "RTL" ? "DIRECTION_RIGHT_TO_LEFT" : "DIRECTION_LEFT_TO_RIGHT";
  return `
        if (!(__layer instanceof TextLayer)) {
          __result = JSON.stringify({ ok: false, failureReason: "target layer is not a text layer" });
        } else {
          var __td = __layer.sourceText.value;
          var __previousText = __td.text;
          var __requiresBidi = ${requiresBidi ? "true" : "false"};
          var __expectedCodeUnits = ${expectedCodeUnits};
          var __dirNote = null;
          var __dirFailureReason = null;
          var __readDirection = function (__doc) {
            try {
              return __doc.direction === undefined || __doc.direction === null ? null : String(__doc.direction);
            } catch (__directionReadError) {
              return null;
            }
          };
          var __readComposer = function (__doc) {
            try {
              return __doc.composerEngine === undefined || __doc.composerEngine === null ? null : String(__doc.composerEngine);
            } catch (__composerReadError) {
              return null;
            }
          };
          var __previousDirection = __readDirection(__td);
          var __previousComposer = __readComposer(__td);
          var __appliedDirection = null;
          var __appliedComposer = null;
          var __wantedDirection = null;
          var __wantedComposer = null;
          __td.text = ${textLiteral};
          if (__requiresBidi) {
            if (typeof ParagraphDirection === "undefined" || ParagraphDirection.${wantedDirectionMember} === undefined) {
              __dirFailureReason = "this text contains right-to-left characters, but this After Effects build exposes no paragraph-direction API (ParagraphDirection) - refusing to write bidirectional text whose base direction cannot be set";
            } else if (typeof ComposerEngine === "undefined" || ComposerEngine.UNIVERSAL_TYPE_ENGINE === undefined) {
              __dirFailureReason = "this text contains right-to-left characters, but this After Effects build exposes no Middle-Eastern-capable composer engine (ComposerEngine.UNIVERSAL_TYPE_ENGINE) - refusing to write text the composer cannot shape correctly";
            } else {
              __wantedDirection = String(ParagraphDirection.${wantedDirectionMember});
              __wantedComposer = String(ComposerEngine.UNIVERSAL_TYPE_ENGINE);
              try {
                __td.direction = ParagraphDirection.${wantedDirectionMember};
              } catch (__directionWriteError) {
                __dirFailureReason = "this text contains right-to-left characters, but its base paragraph direction could not be set: " + (__directionWriteError && __directionWriteError.toString ? __directionWriteError.toString() : String(__directionWriteError));
              }
              if (__dirFailureReason === null) {
                try {
                  __td.composerEngine = ComposerEngine.UNIVERSAL_TYPE_ENGINE;
                } catch (__composerWriteError) {
                  __dirFailureReason = "this text contains right-to-left characters, but its composer engine could not be set to the Middle-Eastern-capable engine: " + (__composerWriteError && __composerWriteError.toString ? __composerWriteError.toString() : String(__composerWriteError));
                }
              }
            }
          }
          if (__dirFailureReason !== null) {
            __result = JSON.stringify({ ok: false, failureReason: __dirFailureReason });
          } else {
            __layer.sourceText.setValue(__td);
            var __storedDoc = __layer.sourceText.value;
            var __storedText = __storedDoc.text;
            __appliedDirection = __readDirection(__storedDoc);
            __appliedComposer = __readComposer(__storedDoc);
            var __textVerified = true;
            var __mismatchAt = -1;
            if (__storedText === null || __storedText === undefined || String(__storedText).length !== __expectedCodeUnits.length) {
              __textVerified = false;
            } else {
              var __storedString = String(__storedText);
              for (var __u = 0; __u < __expectedCodeUnits.length; __u++) {
                if (__storedString.charCodeAt(__u) !== __expectedCodeUnits[__u]) {
                  __textVerified = false;
                  __mismatchAt = __u;
                  break;
                }
              }
            }
            var __directionVerified = __requiresBidi ? __appliedDirection !== null && __appliedDirection === __wantedDirection : true;
            var __composerVerified = __requiresBidi ? __appliedComposer !== null && __appliedComposer === __wantedComposer : true;
            if (!__requiresBidi) {
              __dirNote = "text contains no right-to-left character - the template's own paragraph direction and composer were left unchanged";
            }
            if (!__textVerified) {
              __dirFailureReason = "the stored text does not match the requested code units" + (__mismatchAt >= 0 ? " (first difference at code unit " + __mismatchAt + ")" : " (length differs)") + " - refusing to report a text edit that After Effects did not store exactly";
            } else if (!__directionVerified) {
              __dirFailureReason = "this text contains right-to-left characters, but After Effects did not report the requested base paragraph direction (" + __wantedDirection + ") after writing it (read back: " + (__appliedDirection === null ? "unreadable" : __appliedDirection) + ")";
            } else if (!__composerVerified) {
              __dirFailureReason = "this text contains right-to-left characters, but After Effects did not report the requested Middle-Eastern-capable composer engine after writing it (read back: " + (__appliedComposer === null ? "unreadable" : __appliedComposer) + ")";
            }
            var __directionEvidence = {
              requiredDirection: ${JSON.stringify(analysis.requiredDirection)},
              rtlScripts: ${JSON.stringify(analysis.rtlScripts)},
              isMixed: ${analysis.isMixed ? "true" : "false"},
              requiresBidiHandling: __requiresBidi,
              previousDirection: __previousDirection,
              previousComposerEngine: __previousComposer,
              appliedDirection: __requiresBidi ? __appliedDirection : null,
              appliedComposerEngine: __requiresBidi ? __appliedComposer : null,
              directionVerified: __directionVerified,
              composerVerified: __composerVerified,
              textCodeUnitsVerified: __textVerified,
              codeUnitCount: __expectedCodeUnits.length,
              note: __dirNote
            };
            if (__dirFailureReason !== null) {
              __result = JSON.stringify({ ok: false, failureReason: __dirFailureReason, textDirection: __directionEvidence });
            } else {
              // resultingValue stays exactly what it has always been for
              // SET_TEXT - the stored text string. The direction evidence is
              // a SEPARATE, optional key, so no existing consumer of
              // resultingValue can be affected by it existing.
              __result = JSON.stringify({ ok: true, previousValue: __previousText, resultingValue: ${textLiteral}, textDirection: __directionEvidence });
              ${buildTextAutoFit()}
            }
          }
        }`;
}

/**
 * REAL 2026-09-17 FINDING (session 069b5891, proven by read-only inspection):
 * the approved Hebrew line replaced a 6-character right-aligned template text;
 * being longer, it grew left over a shape filled with EXACTLY the text's own
 * colour (the template's orange circle), so its first letters vanished.
 *
 * After the text is set, if the text layer is a plain unparented 2D layer with
 * static transform and no rotation: every enabled, unparented, unrotated 2D
 * layer BELOW it whose fill colour (enabled Fill effect, else its solid colour)
 * matches the text's colour (enabled Fill effect, else the text fill) within
 * 0.02 per channel is a blocker, bounded by its ADD masks (else its rendered
 * rect), all measured midway through the text's visible time. The text is then
 * shrunk uniformly about its own anchor by the largest factor that separates
 * it from every blocker by a margin (1.25 % of the composition width, at least
 * 8 px) - never enlarged, never moved. A factor below
 * TEXT_AUTO_FIT_MIN_FACTOR fails the operation. Any measurement that cannot
 * be read skips the fit and leaves the replaced text as set.
 */
function buildTextAutoFit(): string {
  return `
          var __fitFailureReason = null;
          try {
            var __fitComp = __layer.containingComp;
            var __fitTransform = __layer.property("ADBE Transform Group");
            var __fitScaleProp = __fitTransform.property("ADBE Scale");
            var __fitAnchorProp = __fitTransform.property("ADBE Anchor Point");
            var __fitPositionProp = __fitTransform.property("ADBE Position");
            var __fitRotationProp = __fitTransform.property("ADBE Rotate Z");
            var __fitFillColour = function (__lyr) {
              var __parade = null;
              try { __parade = __lyr.property("ADBE Effect Parade"); } catch (__paradeError) { __parade = null; }
              if (__parade) {
                for (var __e = 1; __e <= __parade.numProperties; __e++) {
                  var __fx = __parade.property(__e);
                  if (__fx && __fx.matchName === "ADBE Fill" && __fx.enabled) { return __fx.property("ADBE Fill-0002").value; }
                }
              }
              return null;
            };
            var __fitSameColour = function (__c1, __c2) {
              if (!__c1 || !__c2) { return false; }
              for (var __ch = 0; __ch < 3; __ch++) { if (Math.abs(__c1[__ch] - __c2[__ch]) > 0.02) { return false; } }
              return true;
            };
            var __fitLayerBounds = function (__lyr, __time) {
              var __lt = __lyr.property("ADBE Transform Group");
              if (__lt.property("ADBE Rotate Z").valueAtTime(__time, false) !== 0) { return null; }
              var __la = __lt.property("ADBE Anchor Point").valueAtTime(__time, false);
              var __lp = __lt.property("ADBE Position").valueAtTime(__time, false);
              var __ls = __lt.property("ADBE Scale").valueAtTime(__time, false);
              var __box = null;
              var __masks = null;
              try { __masks = __lyr.property("ADBE Mask Parade"); } catch (__maskError) { __masks = null; }
              if (__masks) {
                for (var __m = 1; __m <= __masks.numProperties; __m++) {
                  var __mask = __masks.property(__m);
                  if (!__mask || __mask.maskMode !== MaskMode.ADD || __mask.inverted) { continue; }
                  var __verts = __mask.property("ADBE Mask Shape").valueAtTime(__time, false).vertices;
                  for (var __v = 0; __v < __verts.length; __v++) {
                    if (__box === null) { __box = { left: __verts[__v][0], right: __verts[__v][0], top: __verts[__v][1], bottom: __verts[__v][1] }; }
                    __box.left = Math.min(__box.left, __verts[__v][0]); __box.right = Math.max(__box.right, __verts[__v][0]);
                    __box.top = Math.min(__box.top, __verts[__v][1]); __box.bottom = Math.max(__box.bottom, __verts[__v][1]);
                  }
                }
              }
              if (__box === null) {
                var __rect = __lyr.sourceRectAtTime(__time, false);
                __box = { left: __rect.left, right: __rect.left + __rect.width, top: __rect.top, bottom: __rect.top + __rect.height };
              }
              return {
                left: __lp[0] + (__box.left - __la[0]) * __ls[0] / 100,
                right: __lp[0] + (__box.right - __la[0]) * __ls[0] / 100,
                top: __lp[1] + (__box.top - __la[1]) * __ls[1] / 100,
                bottom: __lp[1] + (__box.bottom - __la[1]) * __ls[1] / 100
              };
            };
            var __textColour = __fitFillColour(__layer);
            if (__textColour === null) {
              try { if (__td.applyFill) { __textColour = __td.fillColor; } } catch (__fillColorError) { __textColour = null; }
            }
            var __fitSupported =
              __textColour !== null && !__layer.threeDLayer && !__layer.parent &&
              __fitScaleProp.numKeys === 0 && __fitAnchorProp.numKeys === 0 && __fitPositionProp.numKeys === 0 && __fitRotationProp.numKeys === 0 &&
              __fitRotationProp.value === 0 && __fitScaleProp.value[0] > 0 && __fitScaleProp.value[1] > 0;
            if (__fitSupported) {
              var __fitTime = (Math.max(__layer.inPoint, 0) + Math.min(__layer.outPoint, __fitComp.duration)) / 2;
              var __textRect = __layer.sourceRectAtTime(__fitTime, false);
              var __fs = __fitScaleProp.value, __fa = __fitAnchorProp.value, __fp = __fitPositionProp.value;
              // Offsets of the text's rendered edges from its anchor at the current scale.
              var __dLeft = (__textRect.left - __fa[0]) * __fs[0] / 100;
              var __dRight = (__textRect.left + __textRect.width - __fa[0]) * __fs[0] / 100;
              var __dTop = (__textRect.top - __fa[1]) * __fs[1] / 100;
              var __dBottom = (__textRect.top + __textRect.height - __fa[1]) * __fs[1] / 100;
              var __margin = Math.max(8, __fitComp.width * 0.0125);
              var __factor = 1;
              for (var __li = __layer.index + 1; __li <= __fitComp.numLayers; __li++) {
                var __other = __fitComp.layer(__li);
                if (!__other || !__other.enabled || __other.threeDLayer || __other.parent || __other instanceof TextLayer) { continue; }
                var __otherColour = __fitFillColour(__other);
                if (__otherColour === null) {
                  try { if (__other.source && __other.source.mainSource instanceof SolidSource) { __otherColour = __other.source.mainSource.color; } } catch (__solidColourError) { __otherColour = null; }
                }
                if (!__fitSameColour(__otherColour, __textColour)) { continue; }
                var __b = __fitLayerBounds(__other, __fitTime);
                if (__b === null) { continue; }
                var __overlaps = __fp[0] + __dLeft < __b.right + __margin && __fp[0] + __dRight > __b.left - __margin &&
                  __fp[1] + __dTop < __b.bottom + __margin && __fp[1] + __dBottom > __b.top - __margin;
                if (!__overlaps) { continue; }
                // Largest shrink factor that separates the text from this blocker on any one side.
                var __best = 0;
                if (__dLeft < 0 && __fp[0] > __b.right + __margin) { __best = Math.max(__best, (__b.right + __margin - __fp[0]) / __dLeft); }
                if (__dRight > 0 && __fp[0] < __b.left - __margin) { __best = Math.max(__best, (__b.left - __margin - __fp[0]) / __dRight); }
                if (__dTop < 0 && __fp[1] > __b.bottom + __margin) { __best = Math.max(__best, (__b.bottom + __margin - __fp[1]) / __dTop); }
                if (__dBottom > 0 && __fp[1] < __b.top - __margin) { __best = Math.max(__best, (__b.top - __margin - __fp[1]) / __dBottom); }
                __factor = Math.min(__factor, Math.min(__best, 1));
              }
              if (__factor < ${TEXT_AUTO_FIT_MIN_FACTOR}) {
                __fitFailureReason = "replaced text overlaps a shape of its own colour and would have to shrink to " + Math.round(__factor * 100) + "% of its template size to stay visible (minimum ${Math.round(TEXT_AUTO_FIT_MIN_FACTOR * 100)}%) - refusing to produce unreadable or hidden text";
              } else if (__factor < 1) {
                var __newTextScale = [__fs[0] * __factor, __fs[1] * __factor];
                if (__fs.length > 2) { __newTextScale.push(__fs[2]); }
                __fitScaleProp.setValue(__newTextScale);
              }
            }
          } catch (__fitError) {
            __fitFailureReason = null;
          }
          if (__fitFailureReason !== null) {
            __result = JSON.stringify({ ok: false, failureReason: __fitFailureReason });
          }`;
}

/** How replaced media fills a screen card: "cover" crops to fill the whole card (screenshots); "contain" shows the whole media, centred, uncropped and unstretched (logos). */
export type MapFootageFit = "cover" | "contain";

/** Shared mutation body for MAP_FOOTAGE - identical for the flat and nested target cases (module doc comment on buildSetTextBody above). */
function buildMapFootageBody(assetPath: string, fit: MapFootageFit): string {
  return withTargetLayerUnlocked(buildMapFootageMutation(assetPath, fit));
}

/**
 * REAL 2026-09-16 FINDING (session 1257ac95): a near-square logo cover-fitted
 * onto a tall screen card was scaled ~500% and cropped to a slice. A
 * "contain" fit therefore never swaps the card solid's source: the solid stays
 * as the card background (with its own colour) and is raised above the card's
 * guide labels, and the media is added as a NEW layer directly above it -
 * centred on the card, scaled uniformly so the whole media fits, with the
 * card's rotation, parent and timing. The card centre is computed through the
 * card's own anchor, scale and rotation, so a non-uniformly scaled or rotated
 * card still centres correctly. Animated card geometry is refused, never
 * guessed. A layer that is not a solid card keeps the plain source swap.
 */
function buildMapFootageContainOnCard(): string {
  return `
              var __cardTransform = __layer.property("ADBE Transform Group");
              var __cardScaleProp = __cardTransform.property("ADBE Scale");
              var __cardAnchorProp = __cardTransform.property("ADBE Anchor Point");
              var __cardPositionProp = __cardTransform.property("ADBE Position");
              var __cardRotationProp = __cardTransform.property("ADBE Rotate Z");
              if (__cardScaleProp.numKeys > 0 || __cardAnchorProp.numKeys > 0 || __cardPositionProp.numKeys > 0 || __cardRotationProp.numKeys > 0) {
                __fitFailure = "screen card layer has animated scale, anchor point, position or rotation - refusing to guess where to place the media";
              } else if (!(__newFootageItem.width > 0 && __newFootageItem.height > 0 && __solidCard.width > 0 && __solidCard.height > 0)) {
                __fitFailure = "screen card or imported media has no usable pixel size";
              } else {
                var __cardScale = __cardScaleProp.value;
                var __cardAnchor = __cardAnchorProp.value;
                var __cardPosition = __cardPositionProp.value;
                var __cardRotation = __cardRotationProp.value;
                if (!(__cardScale[0] > 0 && __cardScale[1] > 0)) {
                  __fitFailure = "screen card layer has a zero or mirrored scale - refusing to guess how to fit the media";
                } else {
                  var __containFactor = Math.min(
                    (__solidCard.width * __cardScale[0] / 100) / __newFootageItem.width,
                    (__solidCard.height * __cardScale[1] / 100) / __newFootageItem.height
                  );
                  var __rotationRadians = __cardRotation * Math.PI / 180;
                  var __offsetX = (__solidCard.width / 2 - __cardAnchor[0]) * __cardScale[0] / 100;
                  var __offsetY = (__solidCard.height / 2 - __cardAnchor[1]) * __cardScale[1] / 100;
                  var __cardCenterX = __cardPosition[0] + __offsetX * Math.cos(__rotationRadians) - __offsetY * Math.sin(__rotationRadians);
                  var __cardCenterY = __cardPosition[1] + __offsetX * Math.sin(__rotationRadians) + __offsetY * Math.cos(__rotationRadians);
                  var __media = __layer.containingComp.layers.add(__newFootageItem);
                  // Parent first: the geometry below is expressed in the card's own parent space.
                  if (__layer.parent) { __media.parent = __layer.parent; }
                  var __mediaTransform = __media.property("ADBE Transform Group");
                  var __mediaAnchor = [__newFootageItem.width / 2, __newFootageItem.height / 2];
                  var __mediaPosition = [__cardCenterX, __cardCenterY];
                  var __mediaScale = [__containFactor * 100, __containFactor * 100];
                  if (__cardAnchor.length > 2) { __mediaAnchor.push(__cardAnchor[2]); }
                  if (__cardPosition.length > 2) { __mediaPosition.push(__cardPosition[2]); }
                  if (__cardScale.length > 2) { __mediaScale.push(__cardScale[2]); }
                  __mediaTransform.property("ADBE Anchor Point").setValue(__mediaAnchor);
                  __mediaTransform.property("ADBE Position").setValue(__mediaPosition);
                  __mediaTransform.property("ADBE Scale").setValue(__mediaScale);
                  __mediaTransform.property("ADBE Rotate Z").setValue(__cardRotation);
                  __media.startTime = __layer.startTime;
                  __media.inPoint = __layer.inPoint;
                  __media.outPoint = __layer.outPoint;
                  // The card background covers its guide labels; the media sits directly above it.
                  __layer.moveToBeginning();
                  __media.moveToBeginning();
                  if (__media.index !== 1 || __layer.index !== 2) {
                    __fitFailure = "contained media was not placed directly above its screen card (media index " + __media.index + ", card index " + __layer.index + ") - its guide labels could show";
                  }
                }
              }`;
}

function buildMapFootageMutation(assetPath: string, fit: MapFootageFit): string {
  const assetPathLiteral = JSON.stringify(assetPath);
  const containOnCard = fit === "contain";
  return `
        if (!(__layer instanceof AVLayer)) {
          __result = JSON.stringify({ ok: false, failureReason: "target layer is not an AV layer" });
        } else {
          var __assetFile = new File(${assetPathLiteral});
          if (!__assetFile.exists) {
            __result = JSON.stringify({ ok: false, failureReason: "asset file does not exist on the worker filesystem: " + __assetFile.fsName });
          } else {
            var __previousSourceName = (__layer.source && __layer.source.name) ? __layer.source.name : null;
            // A uniform solid being replaced is a screen card (the manifest's
            // "place image above" slot): its own size is the area to fill.
            var __solidCard = null;
            try {
              if (__layer.source && __layer.source.mainSource instanceof SolidSource) {
                __solidCard = { width: __layer.source.width, height: __layer.source.height };
              }
            } catch (__solidCardError) {
              __solidCard = null;
            }
            var __importOptions = new ImportOptions(__assetFile);
            var __newFootageItem = app.project.importFile(__importOptions);
            var __fitFailure = null;
            ${containOnCard ? `if (__solidCard !== null) {${buildMapFootageContainOnCard()}
            } else ` : ""}{
            // Card geometry is read BEFORE the source swap: replaceSource itself
            // rescales the layer's anchor point to the new source's size.
            var __cardBefore = null;
            if (__solidCard !== null) {
              var __transformGroup = __layer.property("ADBE Transform Group");
              var __scaleProp = __transformGroup.property("ADBE Scale");
              var __anchorProp = __transformGroup.property("ADBE Anchor Point");
              var __positionProp = __transformGroup.property("ADBE Position");
              var __rotationProp = __transformGroup.property("ADBE Rotate Z");
              __cardBefore = {
                animated: __scaleProp.numKeys > 0 || __anchorProp.numKeys > 0 || __positionProp.numKeys > 0 || __rotationProp.numKeys > 0,
                anchor: __anchorProp.value,
                scale: __scaleProp.value,
                position: __positionProp.value,
                rotation: __rotationProp.value
              };
            }
            __layer.replaceSource(__newFootageItem, false);
            if (__solidCard !== null) {
              // REAL 2026-09-17 FINDING (session 069b5891, proven against the
              // untouched template's own placeholder solids): replaceSource
              // already rescales the layer's anchor point to the new source's
              // size, and the old fit rescaled it a SECOND time (621 x
              // (879/1242)^2 = 311.05), shifting the screenshot 193 px right and
              // ~450 px down on its card; and scaling each axis by the card's own
              // uneven scale (100 x 98.51 %) stretched it 1.5 %. Cover now uses
              // the card geometry read before the swap (above), sets the anchor
              // absolutely to the media's own centre, uses ONE
              // uniform scale for the card's rendered size, and centres the media
              // on the card (centre computed through the card's anchor, scale and
              // rotation). Then raise it above the card's guide labels.
              if (__cardBefore.animated) {
                __fitFailure = "screen card layer has animated scale, anchor point, position or rotation - refusing to guess how to fit the media";
              } else if (!(__newFootageItem.width > 0 && __newFootageItem.height > 0 && __solidCard.width > 0 && __solidCard.height > 0)) {
                __fitFailure = "screen card or imported media has no usable pixel size";
              } else if (!(__cardBefore.scale[0] > 0 && __cardBefore.scale[1] > 0)) {
                __fitFailure = "screen card layer has a zero or mirrored scale - refusing to guess how to fit the media";
              } else {
                var __oldAnchor = __cardBefore.anchor;
                var __oldScale = __cardBefore.scale;
                var __oldPosition = __cardBefore.position;
                var __oldRotationRadians = __cardBefore.rotation * Math.PI / 180;
                var __coverFactor = Math.max(
                  (__solidCard.width * __oldScale[0] / 100) / __newFootageItem.width,
                  (__solidCard.height * __oldScale[1] / 100) / __newFootageItem.height
                );
                var __centerOffsetX = (__solidCard.width / 2 - __oldAnchor[0]) * __oldScale[0] / 100;
                var __centerOffsetY = (__solidCard.height / 2 - __oldAnchor[1]) * __oldScale[1] / 100;
                var __newPosition = [
                  __oldPosition[0] + __centerOffsetX * Math.cos(__oldRotationRadians) - __centerOffsetY * Math.sin(__oldRotationRadians),
                  __oldPosition[1] + __centerOffsetX * Math.sin(__oldRotationRadians) + __centerOffsetY * Math.cos(__oldRotationRadians)
                ];
                var __newAnchor = [__newFootageItem.width / 2, __newFootageItem.height / 2];
                var __newScale = [__coverFactor * 100, __coverFactor * 100];
                if (__oldAnchor.length > 2) { __newAnchor.push(__oldAnchor[2]); }
                if (__oldPosition.length > 2) { __newPosition.push(__oldPosition[2]); }
                if (__oldScale.length > 2) { __newScale.push(__oldScale[2]); }
                __anchorProp.setValue(__newAnchor);
                __positionProp.setValue(__newPosition);
                __scaleProp.setValue(__newScale);
                __layer.moveToBeginning();
                // Verify the ordering actually changed - the media must now be
                // the top layer, above the card's guide labels.
                if (__layer.index !== 1) {
                  __fitFailure = "screen card media was not moved to the top of its composition (layer index is " + __layer.index + ") - its guide labels would cover it";
                }
              }
              // REAL 2026-09-16 FINDING (session 1257ac95): replaceSource keeps the
              // layer's effects, and a template card solid gets its flat colour
              // from an "ADBE Fill" effect. Left on, that Fill paints every
              // opaque pixel of the new media one colour - the screenshot and
              // logo rendered as plain dark-grey cards. Switch those Fill effects
              // off (never delete them) and verify, failing rather than
              // reporting a fill nobody can see. Other effects are left alone.
              if (__fitFailure === null) {
                var __effectParade = null;
                try { __effectParade = __layer.property("ADBE Effect Parade"); } catch (__paradeError) { __effectParade = null; }
                if (__effectParade) {
                  for (var __effectIndex = 1; __effectIndex <= __effectParade.numProperties; __effectIndex++) {
                    var __effect = __effectParade.property(__effectIndex);
                    if (__effect && __effect.matchName === "ADBE Fill" && __effect.enabled) {
                      try { __effect.enabled = false; } catch (__disableError) { /* verified below */ }
                    }
                  }
                  for (var __checkIndex = 1; __checkIndex <= __effectParade.numProperties; __checkIndex++) {
                    var __checkEffect = __effectParade.property(__checkIndex);
                    if (__checkEffect && __checkEffect.matchName === "ADBE Fill" && __checkEffect.enabled) {
                      __fitFailure = "screen card's Fill effect \\"" + __checkEffect.name + "\\" could not be switched off - it would paint the media one flat colour";
                    }
                  }
                }
              }
            }
            }
            if (__fitFailure !== null) {
              __result = JSON.stringify({ ok: false, failureReason: __fitFailure });
            } else {
              __result = JSON.stringify({ ok: true, previousValue: __previousSourceName, resultingValue: __newFootageItem.name });
            }
          }
        }`;
}

function buildSetTextScript(aeProjectItemIndex: number, compositionName: string, layerIndex: number, text: string): FixedJsxScript {
  return withTargets(wrapScript("SET_TEXT", buildSetTextBody(text)), aeProjectItemIndex, compositionName, layerIndex) as FixedJsxScript;
}

function buildMapFootageScript(aeProjectItemIndex: number, compositionName: string, layerIndex: number, assetPath: string, fit: MapFootageFit): FixedJsxScript {
  return withTargets(wrapScript("MAP_FOOTAGE", buildMapFootageBody(assetPath, fit)), aeProjectItemIndex, compositionName, layerIndex) as FixedJsxScript;
}

/**
 * Extracts the numeric AE persistent item id from a manifest compositionId
 * ("comp-1635" -> 1635) - the SAME identity convention
 * buildInspectCompositionPrecompsScript/buildInspectCompositionLayerDetailsScript
 * already use (`"comp-" + item.id`), so a nested step's own expected id can
 * be compared directly against a real `CompItem.id` read live from AE.
 * Throws (a real TypeScript-level bug, never a runtime/user-data issue) if
 * a compositionId does not match this convention - every compositionId
 * reaching this file already came from the manifest, which only ever
 * produces this exact shape.
 */
function parseCompositionNumericId(compositionId: string): number {
  const match = /^comp-(\d+)$/.exec(compositionId);
  if (!match) {
    throw new Error(`compositionId "${compositionId}" does not match the expected "comp-<number>" convention`);
  }
  return Number(match[1]);
}

/**
 * Live QA execution-wiring fix (2026-09-08): the nested-target counterpart
 * to wrapScript above, for a human-added mapping whose real target lives
 * one or more precomp levels below the scene's own top composition
 * (execution-plan.ts's own NestedTargetStep/humanNestedTarget doc
 * comments). Never walks through `.source` chains starting from the
 * scene's own top composition - each step's own composition is resolved
 * DIRECTLY via `app.project.item(step.aeProjectItemIndex)`, the exact same
 * primitive every other script in this file already uses, and its real
 * `.id` is independently verified against the step's own compositionId
 * BEFORE any layer in it is ever touched (never a name-only match - the
 * numeric AE item id is a stronger, duplicate-proof identity name can
 * never provide). For every step except the last, that step's own
 * `layerIndex` is ADDITIONALLY verified to be a real precomp-reference
 * layer whose `.source.id` matches the NEXT step's expected id - this is
 * what makes a stale/broken path (the template changed since this target
 * was verified) fail closed with a clear reason, rather than silently
 * mutating whatever layer now happens to sit at that index. The LAST
 * step's own `layerIndex` becomes the real target `__layer` the caller's
 * `body` mutates - identical contract to wrapScript's own `__layer`.
 */
function wrapNestedScript(operationLabel: string, body: string, nestedTarget: readonly ResolvedNestedTargetStep[]): FixedJsxScript {
  const hopBlocks = nestedTarget
    .map((step, index) => {
      const compIndexLiteral = String(step.aeProjectItemIndex);
      const numericIdLiteral = String(parseCompositionNumericId(step.compositionId));
      // compositionId is always a build-time-known "comp-<digits>" string
      // (parseCompositionNumericId above already threw otherwise) - never
      // contains a quote character, so it is safe to embed directly inside
      // an escaped-quote fragment (matching the SAME \\" ... \\" pattern
      // this file already uses to interpolate a live-read comp/layer NAME
      // into a generated failure message). Never JSON.stringify'd here -
      // that produces a quoted STRING LITERAL TOKEN (its own leading/
      // trailing `"`), which would prematurely close the enclosing
      // generated string if embedded inside it directly, a real bug this
      // exact construction fixes.
      const compIdForMessage = step.compositionId;
      // REAL 2026-09-14 FAILURE: a project-item INDEX is not stable within a
      // job - importing footage (an earlier MAP_FOOTAGE in the same run)
      // inserts a project item and shifts every later index, so step lookup
      // by the stored index found the neighbouring composition. The AE
      // CompItem.id IS stable (the failing lookup itself proved the real
      // composition kept its manifest id), so each step is resolved by
      // scanning for that id; the stored index is only reported as a hint.
      // Exactly one match is required - zero or several fail closed.
      const resolveBlock = `
      if (__pathFailureReason === null) {
        var __stepComp = null;
        var __stepMatches = 0;
        var __stepItemCount = 0;
        try { __stepItemCount = app.project.numItems; } catch (__stepCountError) { __stepItemCount = 0; }
        for (var __stepItemIndex = 1; __stepItemIndex <= __stepItemCount; __stepItemIndex++) {
          var __stepCandidate = null;
          try { __stepCandidate = app.project.item(__stepItemIndex); } catch (__stepLookupError) { __stepCandidate = null; }
          if (__stepCandidate instanceof CompItem && __stepCandidate.id === ${numericIdLiteral}) {
            __stepMatches++;
            __stepComp = __stepCandidate;
          }
        }
        if (__stepMatches === 0) {
          __pathFailureReason = "nested target step ${index}: no composition with id ${numericIdLiteral} (\\"${compIdForMessage}\\") exists in this project (stored project item index hint ${compIndexLiteral}) - stale or broken nested path, refusing to guess";
        } else if (__stepMatches > 1) {
          __pathFailureReason = "nested target step ${index}: " + __stepMatches + " compositions share id ${numericIdLiteral} (\\"${compIdForMessage}\\") - ambiguous nested path, refusing to guess";
        } else {
          __comp = __stepComp;
        }
      }`;
      const isLast = index === nestedTarget.length - 1;
      if (isLast) {
        return resolveBlock;
      }
      const nextStep = nestedTarget[index + 1] as ResolvedNestedTargetStep;
      const nextNumericIdLiteral = String(parseCompositionNumericId(nextStep.compositionId));
      const hopLayerIndexLiteral = String(step.layerIndex);
      const hopBlock = `
      if (__pathFailureReason === null) {
        var __hopLayer = null;
        try { __hopLayer = __comp.layer(${hopLayerIndexLiteral}); } catch (__hopLayerError) { __hopLayer = null; }
        if (__hopLayer === null) {
          __pathFailureReason = "nested target step ${index}: layer index ${hopLayerIndexLiteral} was not found in composition \\"${compIdForMessage}\\"";
        } else if (!(__hopLayer.source && (__hopLayer.source instanceof CompItem))) {
          __pathFailureReason = "nested target step ${index}: layer index ${hopLayerIndexLiteral} does not reference a nested composition - stale or broken nested path";
        } else if (__hopLayer.source.id !== ${nextNumericIdLiteral}) {
          __pathFailureReason = "nested target step ${index}: layer index ${hopLayerIndexLiteral}'s source composition id (" + __hopLayer.source.id + ") does not match the expected next step id ${nextNumericIdLiteral} - stale or broken nested path, refusing to guess";
        }
      }`;
      return `${resolveBlock}${hopBlock}`;
    })
    .join("\n");

  const finalStep = nestedTarget[nestedTarget.length - 1] as ResolvedNestedTargetStep;
  const finalLayerIndexLiteral = String(finalStep.layerIndex);

  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify(`DYO EXECUTE_FRAME: ${operationLabel} (nested)`)});
  var __result = null;
  try {
    var __comp = null;
    var __pathFailureReason = null;
    ${hopBlocks}
    if (__pathFailureReason !== null) {
      __result = JSON.stringify({ ok: false, failureReason: __pathFailureReason });
    } else {
      var __layer = null;
      try {
        __layer = __comp.layer(${finalLayerIndexLiteral});
      } catch (__layerLookupError) {
        __layer = null;
      }
      if (__layer === null) {
        __result = JSON.stringify({ ok: false, failureReason: "layer index ${finalLayerIndexLiteral} was not found in the final target composition" });
      } else {
        ${body}
      }
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

function buildSetTextNestedScript(nestedTarget: readonly ResolvedNestedTargetStep[], text: string): FixedJsxScript {
  return wrapNestedScript("SET_TEXT", buildSetTextBody(text), nestedTarget);
}

function buildMapFootageNestedScript(nestedTarget: readonly ResolvedNestedTargetStep[], assetPath: string, fit: MapFootageFit): FixedJsxScript {
  return wrapNestedScript("MAP_FOOTAGE", buildMapFootageBody(assetPath, fit), nestedTarget);
}

function buildSetLayerVisibilityScript(
  aeProjectItemIndex: number,
  compositionName: string,
  op: Extract<SceneEditOperation, { type: "SET_LAYER_VISIBILITY" }>
): FixedJsxScript {
  const visible = op.visible ? "true" : "false";
  const body = `
        var __previousEnabled = __layer.enabled;
        __layer.enabled = ${visible};
        __result = JSON.stringify({ ok: true, previousValue: __previousEnabled, resultingValue: __layer.enabled });`;
  return withTargets(wrapScript("SET_LAYER_VISIBILITY", body), aeProjectItemIndex, compositionName, op.layerIndex) as FixedJsxScript;
}

function buildSetTimeRemapFreezeScript(
  aeProjectItemIndex: number,
  compositionName: string,
  op: Extract<SceneEditOperation, { type: "SET_TIME_REMAP_FREEZE" }>
): FixedJsxScript {
  const freezeAtSeconds = JSON.stringify(op.freezeAtSeconds);
  const body = `
        if (!(__layer instanceof AVLayer) || !__layer.canSetTimeRemapEnabled) {
          __result = JSON.stringify({ ok: false, failureReason: "target layer does not support time remapping" });
        } else {
          var __previousEnabled = __layer.timeRemapEnabled;
          if (!__layer.timeRemapEnabled) {
            __layer.timeRemapEnabled = true;
          }
          var __timeRemapProp = __layer.timeRemap;
          while (__timeRemapProp.numKeys > 0) {
            __timeRemapProp.removeKey(1);
          }
          __timeRemapProp.setValue(${freezeAtSeconds});
          __result = JSON.stringify({ ok: true, previousValue: __previousEnabled, resultingValue: ${freezeAtSeconds} });
        }`;
  return withTargets(wrapScript("SET_TIME_REMAP_FREEZE", body), aeProjectItemIndex, compositionName, op.layerIndex) as FixedJsxScript;
}

function buildSetDurationScript(aeProjectItemIndex: number, compositionName: string, op: Extract<SceneEditOperation, { type: "SET_DURATION" }>): FixedJsxScript {
  // Layer-scoped (this operation targets one layer, like every other
  // SceneEditOperation - it has no composition-level field) - sets the
  // LAYER's outPoint relative to its own inPoint, never the composition's
  // own duration. See execute-scene-edit.ts's own SET_DURATION doc note.
  const durationSeconds = JSON.stringify(op.durationSeconds);
  const body = `
        var __previousDuration = __layer.outPoint - __layer.inPoint;
        __layer.outPoint = __layer.inPoint + ${durationSeconds};
        __result = JSON.stringify({ ok: true, previousValue: __previousDuration, resultingValue: ${durationSeconds} });`;
  return withTargets(wrapScript("SET_DURATION", body), aeProjectItemIndex, compositionName, op.layerIndex) as FixedJsxScript;
}

function buildSetBrandColorScript(aeProjectItemIndex: number, compositionName: string, op: Extract<SceneEditOperation, { type: "SET_BRAND_COLOR" }>): FixedJsxScript {
  // Only the one exact, unambiguous target type this narrow 2-field
  // operation can safely mean without a free-form property path: a solid
  // color layer's own SolidSource.color. Any other layer/source shape is
  // a typed failure, never a guess (section 9: "unsupported target =>
  // typed failure").
  const rgb = hexToUnitRgb(op.colorHex);
  const rgbLiteral = JSON.stringify(rgb);
  const body = `
        if (!(__layer instanceof AVLayer) || !(__layer.source instanceof SolidSource)) {
          __result = JSON.stringify({ ok: false, failureReason: "target layer's source is not a solid color - SET_BRAND_COLOR only supports solid-color layers" });
        } else {
          var __previousColor = __layer.source.color;
          __layer.source.color = ${rgbLiteral};
          __result = JSON.stringify({ ok: true, previousValue: __previousColor, resultingValue: ${rgbLiteral} });
        }`;
  return withTargets(wrapScript("SET_BRAND_COLOR", body), aeProjectItemIndex, compositionName, op.layerIndex) as FixedJsxScript;
}

/**
 * Builds the native 1080x1920 Reels composition for one scene (2026-08-29
 * closure requirement, section 1) - a comp-level operation, so it does NOT
 * use `wrapScript`'s per-layer-target boilerplate (there is no single
 * target layer). Every step is deterministic and every interpolated value
 * is JSON.stringify'd exactly like every other builder in this file - see
 * this file's own module doc comment.
 *
 * Safety guarantees, all enforced worker-side, never trusted from the
 * caller:
 *   - resolves and name-verifies the SOURCE (landscape) composition first,
 *     identically to wrapScript's own convention, before touching anything,
 *   - never mutates the source composition - CompItem.duplicate() is
 *     AE's own non-destructive copy, so the original is untouched,
 *   - if a composition already exists with the requested
 *     reelsCompositionName (a prior run of this same scene), it is removed
 *     FIRST so re-execution never accumulates stale duplicate compositions,
 *   - resizes ONLY the duplicate to the fixed 1080x1920 frame (never a
 *     caller-supplied dimension - "no arbitrary transform API"),
 *   - for each layerTransforms entry, refuses (typed failure, no silent
 *     overwrite) to touch a layer whose position OR scale property already
 *     carries real keyframes - CLAUDE.md's "preserve original template
 *     animation/structure" - rather than destroying that animation,
 *   - rolls back (removes the half-built duplicate) if any transform
 *     fails partway through, so a failed attempt never leaves a
 *     partially-repositioned Reels composition behind.
 */
function buildBuildReelsCompositionScript(
  aeProjectItemIndex: number,
  compositionName: string,
  op: Extract<SceneEditOperation, { type: "BUILD_REELS_COMPOSITION" }>
): FixedJsxScript {
  const compIndexLiteral = String(aeProjectItemIndex);
  const compNameLiteral = JSON.stringify(compositionName);
  const reelsNameLiteral = JSON.stringify(op.reelsCompositionName);
  const transformsLiteral = JSON.stringify(op.layerTransforms.map((t) => ({ layerIndex: t.layerIndex, positionX: t.positionX, positionY: t.positionY, scalePercent: t.scalePercent })));

  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO EXECUTE_FRAME: BUILD_REELS_COMPOSITION")});
  var __result = null;
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(${compIndexLiteral});
      if (__rawItem instanceof CompItem) {
        __comp = __rawItem;
      }
    } catch (__compLookupError) {
      __comp = null;
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " did not resolve to a composition in this project" });
    } else if (__comp.name !== ${compNameLiteral}) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "project item index " + ${compIndexLiteral} + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + ${compNameLiteral} + "\\" - refusing to mutate the wrong composition"
      });
    } else {
      var __existingIndex = null;
      for (var __i = 1; __i <= app.project.numItems; __i++) {
        var __candidate = app.project.item(__i);
        if (__candidate instanceof CompItem && __candidate.name === ${reelsNameLiteral}) {
          __existingIndex = __i;
          break;
        }
      }
      if (__existingIndex !== null) {
        app.project.item(__existingIndex).remove();
      }

      var __newComp = __comp.duplicate();
      __newComp.name = ${reelsNameLiteral};
      __newComp.width = 1080;
      __newComp.height = 1920;

      var __transformFailure = null;
      var __transforms = ${transformsLiteral};
      for (var __t = 0; __t < __transforms.length; __t++) {
        var __tx = __transforms[__t];
        var __targetLayer = null;
        try {
          __targetLayer = __newComp.layer(__tx.layerIndex);
        } catch (__layerLookupError) {
          __targetLayer = null;
        }
        if (__targetLayer === null) {
          __transformFailure = "layer index " + __tx.layerIndex + " was not found in the new Reels composition";
          break;
        }
        if (__targetLayer.transform.position.numKeys > 0 || __targetLayer.transform.scale.numKeys > 0) {
          __transformFailure = "layer index " + __tx.layerIndex + " has existing keyframe animation on position/scale - refusing to overwrite it and destroy that animation";
          break;
        }
        __targetLayer.transform.position.setValue([__tx.positionX, __tx.positionY]);
        __targetLayer.transform.scale.setValue([__tx.scalePercent, __tx.scalePercent]);
      }

      if (__transformFailure !== null) {
        __newComp.remove();
        __result = JSON.stringify({ ok: false, failureReason: __transformFailure });
      } else {
        var __newIndex = null;
        for (var __j = 1; __j <= app.project.numItems; __j++) {
          if (app.project.item(__j) === __newComp) {
            __newIndex = __j;
            break;
          }
        }
        __result = JSON.stringify({
          ok: true,
          resultingValue: {
            reelsAeProjectItemIndex: __newIndex,
            reelsCompositionName: __newComp.name,
            reelsWidthPx: __newComp.width,
            reelsHeightPx: __newComp.height,
            reelsDurationSeconds: __newComp.duration,
            reelsFrameRate: __newComp.frameRate
          }
        });
      }
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * Builds a genuine top-level 1920x1080 Landscape output composition from
 * the scene's own real, currently-approved content (live QA, 2026-09-10
 * urgent request - "COMPLETE THE MISSING OUTPUT-COMPOSITION STAGE"). A
 * comp-level operation, same shape/safety convention as
 * buildBuildReelsCompositionScript above (duplicate -> resize -> per-layer
 * adjust -> verify), but with ONE fundamental difference: there is no
 * human-reviewed layerTransforms input. This project's real master is a
 * portrait 1080x1920 timeline with no distinct widescreen composition
 * anywhere in the template, and no existing workflow lets a human
 * hand-author per-layer widescreen transforms before today's deadline - so
 * per explicit operator direction, THIS SCRIPT computes each top-level
 * layer's new position/scale itself, from that layer's own real, freshly
 * read AE geometry - never a per-template hardcoded coordinate, never an
 * arbitrary caller-supplied transform.
 *
 * The deterministic, purely geometric rule (identical for every template):
 *   1. Read each of the duplicate's own immediate layers' REAL current
 *      bounding box in the SOURCE composition's own coordinate space, via
 *      the standard AE formula: compLeft = position.x - (anchorPoint.x -
 *      sourceRect.left) * scale.x/100 (same for Y/height), using
 *      `layer.sourceRectAtTime(0, false)` for the layer's own untransformed
 *      bounds.
 *   2. A layer whose bounding box covers most of the source composition's
 *      own frame (>= 85% of both width and height - a background/
 *      full-frame design layer) is rescaled (non-uniformly, since it is
 *      meant to fully cover the frame regardless of aspect) to exactly
 *      fill the new 1920x1080 canvas edge-to-edge.
 *   3. Every OTHER layer (foreground/text/logo/content) keeps its own real
 *      pixel scale unchanged - preserving visual hierarchy/relative size -
 *      unless it would not fit inside the new canvas at all, in which case
 *      it is scaled down (uniformly, aspect preserved, never enlarged) just
 *      enough to fit. It is repositioned to the SAME PROPORTIONAL center
 *      position within the new canvas (oldCenter/oldCompSize mapped onto
 *      newCompSize), then clamped so its own bounding box never extends
 *      past the new frame's own edges - "safe bounds", never off-canvas.
 *
 * Refuses (typed failure, the half-built duplicate composition removed, no
 * silent partial/cropped result) rather than guessing when a layer's own
 * structure cannot be safely adapted by this rule - matching CLAUDE.md/
 * this operator's own explicit instruction ("fail clearly... rather than
 * silently producing a crop"):
 *   - the layer has existing keyframe animation on position/scale (would be
 *     destroyed by a single static transform - the SAME refusal
 *     buildBuildReelsCompositionScript already uses),
 *   - the layer is a 3D layer (this rule's 2D geometry math does not apply
 *     safely to a 3D transform),
 *   - the layer is parented to another layer (correctly adapting it needs
 *     the FULL parent-chain transform, which this deterministic rule does
 *     not attempt - repositioning it alone, while its parent stays
 *     unchanged, would silently produce the wrong final position).
 * A disabled layer or a layer with no video component (hasVideo === false)
 * is left completely untouched (skipped, not refused) - nothing to adapt.
 *
 * Other safety guarantees, identical to buildBuildReelsCompositionScript:
 * resolves and name-verifies the SOURCE composition first; never mutates
 * the source (CompItem.duplicate() is AE's own non-destructive copy); if a
 * composition already exists with the requested horizontalCompositionName
 * (a prior run), it is removed first so re-execution never accumulates
 * stale duplicates; resizes ONLY the duplicate to the fixed 1920x1080
 * frame.
 */
function buildBuildHorizontalCompositionScript(
  aeProjectItemIndex: number,
  compositionName: string,
  op: Extract<SceneEditOperation, { type: "BUILD_HORIZONTAL_COMPOSITION" }>
): FixedJsxScript {
  const compIndexLiteral = String(aeProjectItemIndex);
  const compNameLiteral = JSON.stringify(compositionName);
  const horizontalNameLiteral = JSON.stringify(op.horizontalCompositionName);
  const NEW_WIDTH = 1920;
  const NEW_HEIGHT = 1080;
  const BACKGROUND_COVERAGE_RATIO = 0.85;

  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO EXECUTE_FRAME: BUILD_HORIZONTAL_COMPOSITION")});
  var __result = null;
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(${compIndexLiteral});
      if (__rawItem instanceof CompItem) {
        __comp = __rawItem;
      }
    } catch (__compLookupError) {
      __comp = null;
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " did not resolve to a composition in this project" });
    } else if (__comp.name !== ${compNameLiteral}) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "project item index " + ${compIndexLiteral} + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + ${compNameLiteral} + "\\" - refusing to mutate the wrong composition"
      });
    } else {
      var __existingIndex = null;
      for (var __i = 1; __i <= app.project.numItems; __i++) {
        var __candidate = app.project.item(__i);
        if (__candidate instanceof CompItem && __candidate.name === ${horizontalNameLiteral}) {
          __existingIndex = __i;
          break;
        }
      }
      if (__existingIndex !== null) {
        app.project.item(__existingIndex).remove();
      }

      var __origWidth = __comp.width;
      var __origHeight = __comp.height;
      var __newComp = __comp.duplicate();
      __newComp.name = ${horizontalNameLiteral};
      __newComp.width = ${NEW_WIDTH};
      __newComp.height = ${NEW_HEIGHT};

      var __adaptFailure = null;
      for (var __li = 1; __li <= __newComp.numLayers; __li++) {
        var __layer = __newComp.layer(__li);
        if (!__layer.enabled) { continue; }
        if (!__layer.hasVideo) { continue; }
        if (__layer.threeDLayer) {
          __adaptFailure = "layer " + __li + " (\\"" + __layer.name + "\\") is a 3D layer - cannot be safely adapted by 2D geometry rules";
          break;
        }
        if (__layer.parent !== null) {
          __adaptFailure = "layer " + __li + " (\\"" + __layer.name + "\\") is parented to another layer - cannot be safely adapted without a full parent-chain transform, which this deterministic rule does not attempt";
          break;
        }
        if (__layer.transform.position.numKeys > 0 || __layer.transform.scale.numKeys > 0) {
          __adaptFailure = "layer " + __li + " (\\"" + __layer.name + "\\") has existing keyframe animation on position/scale - refusing to overwrite it and destroy that animation";
          break;
        }
        var __srcRect = null;
        try {
          __srcRect = __layer.sourceRectAtTime(0, false);
        } catch (__srcRectError) {
          __srcRect = null;
        }
        if (__srcRect === null || __srcRect.width <= 0 || __srcRect.height <= 0) {
          __adaptFailure = "layer " + __li + " (\\"" + __layer.name + "\\") has no readable bounding box - cannot be safely adapted";
          break;
        }

        var __anchor = __layer.transform.anchorPoint.value;
        var __pos = __layer.transform.position.value;
        var __scale = __layer.transform.scale.value;
        var __compLeft = __pos[0] - (__anchor[0] - __srcRect.left) * (__scale[0] / 100);
        var __compTop = __pos[1] - (__anchor[1] - __srcRect.top) * (__scale[1] / 100);
        var __compWidth = __srcRect.width * (__scale[0] / 100);
        var __compHeight = __srcRect.height * (__scale[1] / 100);
        if (__compWidth <= 0 || __compHeight <= 0) { continue; }

        var __isBackground = (__compWidth >= ${BACKGROUND_COVERAGE_RATIO} * __origWidth) && (__compHeight >= ${BACKGROUND_COVERAGE_RATIO} * __origHeight);
        var __newScaleX, __newScaleY, __newPosX, __newPosY;

        if (__isBackground) {
          __newScaleX = __scale[0] * (${NEW_WIDTH} / __compWidth);
          __newScaleY = __scale[1] * (${NEW_HEIGHT} / __compHeight);
          __newPosX = (__anchor[0] - __srcRect.left) * (__newScaleX / 100);
          __newPosY = (__anchor[1] - __srcRect.top) * (__newScaleY / 100);
        } else {
          var __fitFactor = Math.min(1, ${NEW_WIDTH} / __compWidth, ${NEW_HEIGHT} / __compHeight);
          __newScaleX = __scale[0] * __fitFactor;
          __newScaleY = __scale[1] * __fitFactor;
          var __compWidthNew = __compWidth * __fitFactor;
          var __compHeightNew = __compHeight * __fitFactor;

          var __oldCenterX = __compLeft + __compWidth / 2;
          var __oldCenterY = __compTop + __compHeight / 2;
          var __newCenterX = (__oldCenterX / __origWidth) * ${NEW_WIDTH};
          var __newCenterY = (__oldCenterY / __origHeight) * ${NEW_HEIGHT};

          var __halfW = __compWidthNew / 2;
          var __halfH = __compHeightNew / 2;
          if (__newCenterX - __halfW < 0) { __newCenterX = __halfW; }
          if (__newCenterX + __halfW > ${NEW_WIDTH}) { __newCenterX = ${NEW_WIDTH} - __halfW; }
          if (__newCenterY - __halfH < 0) { __newCenterY = __halfH; }
          if (__newCenterY + __halfH > ${NEW_HEIGHT}) { __newCenterY = ${NEW_HEIGHT} - __halfH; }

          var __newLeft = __newCenterX - __halfW;
          var __newTop = __newCenterY - __halfH;
          __newPosX = __newLeft + (__anchor[0] - __srcRect.left) * (__newScaleX / 100);
          __newPosY = __newTop + (__anchor[1] - __srcRect.top) * (__newScaleY / 100);
        }

        __layer.transform.position.setValue([__newPosX, __newPosY]);
        __layer.transform.scale.setValue([__newScaleX, __newScaleY]);
      }

      if (__adaptFailure !== null) {
        __newComp.remove();
        __result = JSON.stringify({ ok: false, failureReason: __adaptFailure });
      } else {
        var __newIndex = null;
        for (var __j = 1; __j <= app.project.numItems; __j++) {
          if (app.project.item(__j) === __newComp) {
            __newIndex = __j;
            break;
          }
        }
        __result = JSON.stringify({
          ok: true,
          resultingValue: {
            horizontalAeProjectItemIndex: __newIndex,
            horizontalCompositionName: __newComp.name,
            horizontalWidthPx: __newComp.width,
            horizontalHeightPx: __newComp.height,
            horizontalDurationSeconds: __newComp.duration,
            horizontalFrameRate: __newComp.frameRate
          }
        });
      }
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/** #RRGGBB (already validated by setBrandColorOperationSchema's regex) -> [r,g,b] in AE's native 0..1 float range. */
function hexToUnitRgb(colorHex: string): [number, number, number] {
  const r = parseInt(colorHex.slice(1, 3), 16) / 255;
  const g = parseInt(colorHex.slice(3, 5), 16) / 255;
  const b = parseInt(colorHex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

/**
 * Saves the currently-open project IN PLACE via `app.project.save()` -
 * never `saveWithDialog()`, never `save(File)` with a caller-supplied
 * path. This only ever runs against the WORKING COPY that
 * execute-scene-edit-executor.ts already opened (CLAUDE.md Safety Rule 1:
 * the original .aep is never opened for editing in the first place, so
 * there is no path here that could ever save over it). No composition/
 * layer resolution is needed - this is a project-level operation, so it
 * does not use `wrapScript`'s per-target lookup boilerplate.
 */
export function buildSaveProjectScript(): FixedJsxScript {
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO EXECUTE_FRAME: SAVE_PROJECT")});
  var __result = null;
  try {
    app.project.save();
    __result = JSON.stringify({ ok: true, resultingValue: app.project.file ? app.project.file.fsName : null });
  } catch (__saveError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "save failed: " + (__saveError && __saveError.toString ? __saveError.toString() : String(__saveError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * P0 fix (2026-09-03, real production incident): opens a specific target
 * .aep as AE's active project. INSPECT_TEMPLATE previously only ever
 * queried whatever project happened to already be open in AE (see
 * heroic-swan-template-inspector.ts's own doc comment on why) - a real
 * client attempt proved this unsafe: AE had an unrelated "Untitled"
 * project open (projectPath: null, an 87-item leftover project), and
 * inspection would have silently queried THAT instead of the real
 * requested template had the two real discovery calls not also timed
 * out. This is a project-level operation (no per-layer target), so it
 * does not use `wrapScript`'s per-layer boilerplate.
 *
 * Deliberately does NOT touch the PREVIOUSLY open project before
 * switching - no `app.project.dirty = false`, no save, no close call of
 * its own.
 *
 * Modal-safe fix (2026-09-03, real production incident): a real client
 * attempt showed AE presenting a native "19 files are missing since you
 * last saved this project" modal while opening the target project - this
 * leaves AE technically ONLINE (the MCP bridge process is alive) while
 * blocking all further scripting/MCP calls, which then all fail with a
 * transient MCP -32001 timeout. Missing-footage warnings on a template
 * project are EXPECTED, not exceptional (a template's own linked footage
 * is often intentionally absent until real client assets are substituted
 * later in the pipeline) - the client should never need to click OK on
 * an informational dialog just so the Worker can inspect a file.
 *
 * `app.beginSuppressDialogs()` / `app.endSuppressDialogs(false)` are
 * scoped in their own try/finally, tightly around ONLY the `app.open()`
 * call itself - never left engaged for the rest of this script, never
 * engaged globally or for any other operation. `endSuppressDialogs(false)`
 * (never `true`) so ending suppression never itself pops a "dialogs were
 * suppressed" summary alert - that would just reintroduce the exact
 * blocking-modal problem this fix exists to close.
 *
 * This does NOT introduce an auto-save risk: this script never calls
 * app.project.save() anywhere, on either the previously-open project or
 * the newly-opened one (CLAUDE.md Safety Rule 1). AE's own suppressed-
 * dialogs behavior for a dirty previous project defaults to discarding
 * its unsaved changes rather than saving them - the opposite of an
 * auto-save risk. That previous project is never the original template
 * .aep (which this Worker never opens directly for editing - it always
 * operates on a copy, per sourceProjectPath's own existing contract) and
 * is typically a leftover/scratch project from an earlier session (the
 * real incident's own evidence: an untitled, unrelated "Untitled"
 * project) - discarding it is the intended, safe behavior, not a
 * regression.
 *
 * Suppressing dialogs never hides a REAL deterministic failure: a false
 * return from `app.open()`, or any thrown exception, is still reported
 * exactly as before via `ok: false` - only the modal UI interruption
 * itself is suppressed, never the underlying success/failure signal this
 * script reports back.
 *
 * Never calls app.project.save() on its own. sourceProjectPath must
 * already be a COPY of the source .aep - inspectTemplateRequestSchema's
 * own existing contract, unchanged by this fix; this script has no way
 * to enforce that itself, it only ever opens exactly the path it is
 * given. The caller (heroic-swan-template-inspector.ts) independently
 * re-reads app.project.file after this call and fails the whole
 * inspection closed if it does not exactly match the requested path -
 * this script's own report is evidence, never trusted blindly.
 */
export function buildOpenProjectScript(sourceProjectPath: string): FixedJsxScript {
  const pathLiteral = JSON.stringify(sourceProjectPath);
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO INSPECT_TEMPLATE: ensure target project open")});
  var __result = null;
  try {
    var __targetFile = new File(${pathLiteral});
    var __opened;
    app.beginSuppressDialogs();
    try {
      __opened = app.open(__targetFile);
    } finally {
      app.endSuppressDialogs(false);
    }
    if (!__opened) {
      __result = JSON.stringify({ ok: false, failureReason: "app.open() did not return an opened project" });
    } else {
      __result = JSON.stringify({
        ok: true,
        resultingValue: {
          openedPath: app.project && app.project.file ? app.project.file.fsName : null,
          openedName: app.project ? app.project.name : null
        }
      });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * Opens a session working copy FROM DISK, discarding unsaved in-memory
 * edits to that same file.
 *
 * REAL 2026-09-14 FAILURE: an EXECUTE_FRAME run applied three operations to
 * the working copy in memory and then failed before saving. AE kept that
 * project open with the partial edits, and buildOpenProjectScript simply
 * reuses an already-open project - so a fresh retry would have re-applied
 * every operation on top of that unsaved state (one of them had already
 * re-ordered layers). The on-disk working copy is the only persisted state
 * of a session, so a fresh run must start from it.
 *
 * Only the requested file is ever closed, and only without saving: a
 * different open project is never touched (app.open's own behavior still
 * applies to it). Never the immutable source - callers pass the session's
 * working-copy path, which the executor independently refuses when it
 * resolves to the source.
 */
export function buildReopenProjectFromDiskScript(workingProjectPath: string): FixedJsxScript {
  const pathLiteral = JSON.stringify(workingProjectPath);
  const script = `${JSON_STRINGIFY_POLYFILL}var __result = null;
  try {
    var __targetFile = new File(${pathLiteral});
    if (!__targetFile.exists) {
      __result = JSON.stringify({ ok: false, failureReason: "working copy does not exist on disk: " + __targetFile.fsName });
    } else {
      var __closedUnsaved = false;
      var __openFile = app.project && app.project.file ? app.project.file : null;
      if (__openFile !== null && __openFile.fsName.toLowerCase() === __targetFile.fsName.toLowerCase()) {
        app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        __closedUnsaved = true;
      }
      var __opened;
      app.beginSuppressDialogs();
      try {
        __opened = app.open(__targetFile);
      } finally {
        app.endSuppressDialogs(false);
      }
      if (!__opened) {
        __result = JSON.stringify({ ok: false, failureReason: "app.open() did not return an opened project" });
      } else {
        __result = JSON.stringify({
          ok: true,
          previousValue: { closedUnsavedCopy: __closedUnsaved },
          resultingValue: {
            openedPath: app.project && app.project.file ? app.project.file.fsName : null,
            openedName: app.project ? app.project.name : null
          }
        });
      }
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * READ-ONLY render-capability inspection (render-delivery phase section
 * 10 - INSPECT_RENDER_CAPABILITIES) - preparing for the final Windows
 * Worker package. There is no allowlisted read-only ae-mcp tool that
 * exposes AE's own Render Queue template names (ALLOWED_INSPECTION_TOOLS
 * in heroic-swan-mcp-client.ts has no such tool), so - exactly like every
 * other script in this file - this is a FIXED, reviewed, versioned
 * script sent through the same `ae_run_jsx` "unsafe" channel EXECUTE_FRAME
 * already uses, never an arbitrary/ad-hoc one.
 *
 * Never mutates project CONTENT and never saves: it adds ONE temporary
 * render-queue item (AE's own documented way to enumerate
 * `RenderQueueItem.templates`/`OutputModule.templates` - both real,
 * off-project-content, ExtendScript-native properties) purely to read
 * its `.templates`/`.outputModule(1).templates` arrays, then immediately
 * removes that same item in a `finally` block before returning - the
 * render queue is left exactly as it was found, and `app.project.save()`
 * is never called at all. Wrapped in `beginUndoGroup`/`endUndoGroup` like
 * every other script here (Safety Rule 3), even though nothing here would
 * actually need undoing.
 *
 * UNVERIFIED against a real AE installation (no Windows/AE access in this
 * environment) - the exact real property names/behavior of
 * RenderQueueItem.templates and OutputModule.templates on AE 2026 must be
 * confirmed on the real client machine before this is trusted (see
 * REAL_AE_TEMPLATE_NAMES_PROVEN in the render-delivery phase's own
 * report). If either property does not behave as expected, this fails
 * closed (typed failureReason), never fabricates a template name list.
 */
export function buildInspectRenderCapabilitiesScript(): FixedJsxScript {
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO INSPECT_RENDER_CAPABILITIES")});
  var __result = null;
  var __tempItem = null;
  try {
    var __comp = null;
    for (var __i = 1; __i <= app.project.numItems; __i++) {
      var __candidate = app.project.item(__i);
      if (__candidate instanceof CompItem) {
        __comp = __candidate;
        break;
      }
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "no composition exists in this project to enumerate render templates against" });
    } else {
      __tempItem = app.project.renderQueue.items.add(__comp);
      var __renderSettingsTemplateNames = __tempItem.templates;
      var __outputModule = __tempItem.outputModule(1);
      var __outputModuleTemplateNames = __outputModule.templates;
      __result = JSON.stringify({
        ok: true,
        renderSettingsTemplateNames: __renderSettingsTemplateNames,
        outputModuleTemplateNames: __outputModuleTemplateNames
      });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    if (__tempItem !== null) {
      try {
        __tempItem.remove();
      } catch (__removeError) {
        // Best-effort cleanup - if removal itself fails, the __result
        // above (already computed) is still returned honestly rather than
        // masked by a cleanup-path error.
      }
    }
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * READ-ONLY composition-nesting inspection (client-facing UX redesign,
 * "LIVE UX ACCEPTANCE FAILED" follow-up: Simple Mode was showing every
 * raw composition - Logo, Placeholder_1..13, Text 01/02/03, Phone_Comp,
 * Scene_XX - as its own "scene"). ae-mcp's own built-in read-only tools
 * never expose a layer's source composition (see
 * heroic-swan-template-inspector.ts's own doc comment on why
 * isNestedOnlyReferenced/parentCompositionIds previously defaulted to
 * false/[] with no real evidence available at all), so - exactly like
 * buildInspectRenderCapabilitiesScript - this is a FIXED, reviewed,
 * versioned script sent through the same `ae_run_jsx` "unsafe" channel
 * EXECUTE_FRAME already uses, never an arbitrary one. Purely read-only:
 * it never assigns any project property and never calls
 * app.project.save() - wrapped in beginUndoGroup/endUndoGroup only to
 * match every other script in this file's own convention, not because
 * anything here needs to be undoable.
 *
 * For each layer in the target composition, `layer.source` is a real,
 * documented, stable AVLayer property; when the layer's source is itself
 * a CompItem (an `instanceof CompItem` check - the SAME real API this
 * file's own resolveComp-style lookups already use, just checked against
 * a layer's source instead of a project item), that layer is a precomp/
 * nested-composition reference, and `layer.source.id` is AE's own
 * persistent composition id - the SAME identity build-project-facts.ts
 * already prefers for compositionId (`comp-${detail.compId}`), so a
 * result here composes directly with the rest of the manifest with no
 * separate identity-reconciliation step. A single layer whose `.source`
 * cannot be read is skipped (honestly omitted, never guessed) rather than
 * failing the whole composition's result.
 *
 * UNVERIFIED against a real AE installation (no Windows/AE access in this
 * environment) - `layer.source`/`CompItem`/`.id` are extremely stable,
 * long-documented ExtendScript APIs (the same category of API this file's
 * OTHER scripts already rely on and that has held up against real AE),
 * but this specific script must still be confirmed against a real
 * client's project before its output is trusted as fact - see the
 * client-facing UX redesign report's own PRODUCTION_HEALTH note. Fails
 * closed (typed failureReason) on any unexpected error - never fabricates
 * a nesting relationship.
 */
export function buildInspectCompositionPrecompsScript(aeProjectItemIndex: number, compositionName: string): FixedJsxScript {
  const compIndexLiteral = String(aeProjectItemIndex);
  const compNameLiteral = JSON.stringify(compositionName);
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO INSPECT_COMPOSITION_PRECOMPS")});
  var __result = null;
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(${compIndexLiteral});
      if (__rawItem instanceof CompItem) {
        __comp = __rawItem;
      }
    } catch (__compLookupError) {
      __comp = null;
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " did not resolve to a composition in this project" });
    } else if (__comp.name !== ${compNameLiteral}) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "project item index " + ${compIndexLiteral} + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + ${compNameLiteral} + "\\" - refusing to report facts about the wrong composition"
      });
    } else {
      var __precompLayers = [];
      for (var __i = 1; __i <= __comp.numLayers; __i++) {
        try {
          var __layer = __comp.layer(__i);
          if (__layer.source && (__layer.source instanceof CompItem)) {
            __precompLayers.push({ layerIndex: __layer.index, layerName: __layer.name, sourceCompositionId: "comp-" + __layer.source.id });
          }
        } catch (__layerReadError) {
          // A single unreadable layer never fails the whole composition's
          // result - it is simply not reported as a precomp reference.
        }
      }
      __result = JSON.stringify({ ok: true, precompLayers: __precompLayers });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * Preview Timing Analysis (live QA, 2026-09-09): also reads `layer.stretch`
 * (real, standard AE DOM property, percent - default 100) and
 * `layer.timeRemapEnabled` (real, standard AVLayer DOM property) for every
 * layer, the same defensive try/catch-then-null pattern already used for
 * every other optional fact here. Neither is exposed by the upstream
 * ae-mcp `layer.get` tool (confirmed 2026-09-09 by reading its real
 * `layerSummary()` implementation directly - it reads only index/name/
 * enabled/inPoint/outPoint/startTime/nullLayer/threeDLayer/parent, plus
 * position/scale/rotation/opacity/effects when detailed) - this script's
 * own `ae_run_jsx` channel is the only way to obtain them, same as this
 * script already does for layerType/sourceText/sourceCompositionId.
 *
 * Live QA, 2026-09-10 real incident (session a7fee3d9, timestamp
 * 4.93827160493827s): a recommended First Preview timestamp fell inside a
 * text layer's own confirmed-visible inPoint/outPoint window, yet the
 * rendered frame showed no text - the ae-mcp `detailed` `layer.get`
 * response DOES include `opacity`, but only ever a single point-in-time
 * sample (see LayerDetail's own comment in parse-mcp-shapes.ts), never
 * whether it is keyframed or what its real keyframe times/values are -
 * exactly the same class of gap `stretch`/`timeRemapEnabled` already
 * closed above. This script now also reads `layer.opacity.numKeys`: when
 * 0 (not animated), `opacityStatic` is the real, single `layer.opacity.value`;
 * when >0, `opacityKeyframes` is the REAL, ordered list of every keyframe's
 * own `keyTime`/`keyValue` (both in the layer's own containing
 * composition's timeline, the same convention `inPoint`/`outPoint`
 * already use) - so a static opacity-0 layer can be told apart from a
 * layer that genuinely fades in/out, rather than a single sample being
 * mistaken for the whole timeline.
 *
 * Generic, template-agnostic, read-only layer-classification script
 * (live-QA "generic AE layer-discovery capability" requirement - never
 * hardcodes a composition name/id/layer index, works against ANY
 * composition passed in). For every layer in the target composition,
 * classifies it using the same category of stable, long-documented
 * ExtendScript DOM checks buildInspectCompositionPrecompsScript already
 * relies on:
 *   - `layer instanceof TextLayer` (checked FIRST - TextLayer is itself a
 *     subtype of AVLayer in the AE scripting DOM, so testing AVLayer first
 *     would misclassify every text layer) => "TEXT", with `sourceText`
 *     read from the real `layer.sourceText.value.text` (the same object
 *     model SET_TEXT's own mutation script already writes through - see
 *     buildSetTextScript above).
 *   - else `layer.source instanceof CompItem` => "PRECOMP", with
 *     `sourceCompositionId` set to `"comp-" + layer.source.id` - the exact
 *     same identity convention buildInspectCompositionPrecompsScript
 *     already uses, so a result here composes directly with the existing
 *     manifest composition graph with no separate reconciliation step.
 *   - else `layer instanceof AVLayer` => "AV".
 *   - anything else (shape/solid/camera/light/adjustment, or an
 *     unrecognized layer type) => "OTHER".
 * A single layer whose properties cannot be read is skipped (honestly
 * omitted, never guessed) rather than failing the whole composition's
 * result - same fail-partial-not-fail-closed posture as the precomp
 * script. Read-only: never calls `.setSource`/`.sourceText.setValue`/
 * `.remove()` or anything else that could mutate the project.
 */
export function buildInspectCompositionLayerDetailsScript(
  aeProjectItemIndex: number,
  compositionName: string,
  mode: "full" | "discovery" = "full"
): FixedJsxScript {
  const compIndexLiteral = String(aeProjectItemIndex);
  const compNameLiteral = JSON.stringify(compositionName);
  // "discovery" mode skips the stretch/timeRemapEnabled/opacity/sourceText
  // property reads entirely (real incident, 2026-09-10, session a7fee3d9):
  // a large top-level render composition (!Render, ~40+ layers) made the
  // "full" scan below time out over MCP (each of those four reads costs
  // real, non-trivial AE engine round-trip time per layer, multiplied
  // across every layer regardless of whether that layer is even relevant
  // to any mapping's own chain). Graph-DISCOVERY only ever needs
  // layerType/sourceCompositionId (to find which layer hosts a given
  // nested composition) - never the heavier per-layer facts - so this
  // mode keeps the SAME classification logic (still needs
  // `layer.source instanceof CompItem`, itself cheap) while skipping the
  // four expensive reads, keeping the full-composition scan safe
  // regardless of composition size. "full" mode (the default, used for a
  // mapping's own known-small nested precomps) is completely unchanged.
  const heavyReadsLiteral =
    mode === "discovery"
      ? `var __stretchPercent = null;
          var __timeRemapEnabled = null;
          var __opacityStatic = null;
          var __opacityKeyframes = null;
          var __skipSourceTextRead = true;`
      : `var __skipSourceTextRead = false;
          var __stretchPercent = null;
          try {
            __stretchPercent = __layer.stretch;
          } catch (__stretchReadError) {
            __stretchPercent = null;
          }
          var __timeRemapEnabled = null;
          try {
            __timeRemapEnabled = __layer.timeRemapEnabled;
          } catch (__timeRemapReadError) {
            __timeRemapEnabled = null;
          }
          var __opacityStatic = null;
          var __opacityKeyframes = null;
          try {
            var __opacityProp = __layer.opacity;
            if (__opacityProp.numKeys === 0) {
              __opacityStatic = __opacityProp.value;
            } else {
              __opacityKeyframes = [];
              for (var __opacityKeyIndex = 1; __opacityKeyIndex <= __opacityProp.numKeys; __opacityKeyIndex++) {
                __opacityKeyframes.push({
                  timeSeconds: __opacityProp.keyTime(__opacityKeyIndex),
                  valuePercent: __opacityProp.keyValue(__opacityKeyIndex)
                });
              }
            }
          } catch (__opacityReadError) {
            __opacityStatic = null;
            __opacityKeyframes = null;
          }`;
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO INSPECT_COMPOSITION_LAYER_DETAILS")});
  var __result = null;
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(${compIndexLiteral});
      if (__rawItem instanceof CompItem) {
        __comp = __rawItem;
      }
    } catch (__compLookupError) {
      __comp = null;
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " did not resolve to a composition in this project" });
    } else if (__comp.name !== ${compNameLiteral}) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "project item index " + ${compIndexLiteral} + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + ${compNameLiteral} + "\\" - refusing to report facts about the wrong composition"
      });
    } else {
      var __layerDetails = [];
      for (var __i = 1; __i <= __comp.numLayers; __i++) {
        try {
          var __layer = __comp.layer(__i);
          var __layerType = "OTHER";
          var __sourceText = null;
          var __sourceCompositionId = null;
          ${heavyReadsLiteral}
          if (__layer instanceof TextLayer) {
            __layerType = "TEXT";
            if (!__skipSourceTextRead) {
              try {
                __sourceText = __layer.sourceText.value.text;
              } catch (__textReadError) {
                __sourceText = null;
              }
            }
          } else if (__layer.source && (__layer.source instanceof CompItem)) {
            __layerType = "PRECOMP";
            __sourceCompositionId = "comp-" + __layer.source.id;
          } else if (__layer instanceof AVLayer) {
            __layerType = "AV";
          }
          __layerDetails.push({
            layerIndex: __layer.index,
            layerName: __layer.name,
            layerType: __layerType,
            sourceText: __sourceText,
            sourceCompositionId: __sourceCompositionId,
            stretchPercent: __stretchPercent,
            timeRemapEnabled: __timeRemapEnabled,
            opacityStatic: __opacityStatic,
            opacityKeyframes: __opacityKeyframes
          });
        } catch (__layerReadError) {
          // A single unreadable layer never fails the whole composition's
          // result - it is simply not reported.
        }
      }
      __result = JSON.stringify({ ok: true, layerDetails: __layerDetails });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * Preview Timing Analysis targeted host-layer lookup (live QA, 2026-09-10
 * real incident, session a7fee3d9): `buildInspectCompositionLayerDetailsScript`'s
 * own "discovery" mode + early-exit optimization STILL timed out scanning
 * a large master render composition (!Render) - because even with the
 * four expensive property reads removed, it still built a full
 * classification record (TextLayer/AVLayer/PRECOMP typing, an object
 * literal, an array push) for EVERY layer up to wherever the match
 * happened to be, which for a composition with many dozens of layers is
 * itself real, non-trivial per-layer cost.
 *
 * This is a genuinely different, minimal operation: for EVERY layer, it
 * does ONLY the cheapest possible check (`layer.source instanceof
 * CompItem`, then a plain string comparison against the one real
 * `childSourceCompositionId` this call cares about) - no TextLayer check,
 * no object construction, no array push - for every layer that is NOT a
 * match. The full, real per-layer facts (enabled/inPoint/outPoint/
 * startTime/stretch/timeRemapEnabled/opacity) are only ever read for a
 * layer that IS a match, which is expected to be a small handful at most.
 * O(numLayers) cheap comparisons + O(matches) expensive reads, never
 * O(numLayers) expensive reads - and never returns anything for a
 * non-matching layer at all, unlike layerDetails' own full/discovery
 * modes.
 *
 * Continues scanning every layer even after a match is found (never an
 * early `break`) - a real AE composition CAN legitimately place the same
 * nested composition at more than one layer (e.g. a duplicated element),
 * and silently returning only the first would silently under-report real
 * branding visibility. `matches` is therefore always the COMPLETE set of
 * real host layers, never just one.
 */
export function buildFindHostLayersScript(aeProjectItemIndex: number, compositionName: string, childSourceCompositionId: string): FixedJsxScript {
  const compIndexLiteral = String(aeProjectItemIndex);
  const compNameLiteral = JSON.stringify(compositionName);
  const childIdLiteral = JSON.stringify(childSourceCompositionId);
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO FIND_HOST_LAYERS")});
  var __result = null;
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(${compIndexLiteral});
      if (__rawItem instanceof CompItem) {
        __comp = __rawItem;
      }
    } catch (__compLookupError) {
      __comp = null;
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " did not resolve to a composition in this project" });
    } else if (__comp.name !== ${compNameLiteral}) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "project item index " + ${compIndexLiteral} + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + ${compNameLiteral} + "\\" - refusing to report facts about the wrong composition"
      });
    } else {
      var __matches = [];
      for (var __i = 1; __i <= __comp.numLayers; __i++) {
        try {
          var __layer = __comp.layer(__i);
          // The one cheap check every layer pays - no classification, no
          // object construction, no property reads beyond this for a
          // non-matching layer.
          if (__layer.source && (__layer.source instanceof CompItem) && ("comp-" + __layer.source.id) === ${childIdLiteral}) {
            var __stretchPercent = null;
            try {
              __stretchPercent = __layer.stretch;
            } catch (__stretchReadError) {
              __stretchPercent = null;
            }
            var __timeRemapEnabled = null;
            try {
              __timeRemapEnabled = __layer.timeRemapEnabled;
            } catch (__timeRemapReadError) {
              __timeRemapEnabled = null;
            }
            var __opacityStatic = null;
            var __opacityKeyframes = null;
            try {
              var __opacityProp = __layer.opacity;
              if (__opacityProp.numKeys === 0) {
                __opacityStatic = __opacityProp.value;
              } else {
                __opacityKeyframes = [];
                for (var __opacityKeyIndex = 1; __opacityKeyIndex <= __opacityProp.numKeys; __opacityKeyIndex++) {
                  __opacityKeyframes.push({
                    timeSeconds: __opacityProp.keyTime(__opacityKeyIndex),
                    valuePercent: __opacityProp.keyValue(__opacityKeyIndex)
                  });
                }
              }
            } catch (__opacityReadError) {
              __opacityStatic = null;
              __opacityKeyframes = null;
            }
            __matches.push({
              layerIndex: __layer.index,
              layerName: __layer.name,
              enabled: __layer.enabled,
              inPointSeconds: __layer.inPoint,
              outPointSeconds: __layer.outPoint,
              startTimeSeconds: __layer.startTime,
              sourceCompositionId: ${childIdLiteral},
              stretchPercent: __stretchPercent,
              timeRemapEnabled: __timeRemapEnabled,
              opacityStatic: __opacityStatic,
              opacityKeyframes: __opacityKeyframes
            });
          }
        } catch (__layerReadError) {
          // A single unreadable layer never fails the whole scan - it is
          // simply not reported (same fail-partial posture as every other
          // read-only inspection script in this file).
        }
      }
      __result = JSON.stringify({ ok: true, matches: __matches });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * Real 2026-09-10 incident (session a7fee3d9): a Complete Preview of the
 * new Landscape master rendered successfully, but visible content ended
 * around 7s of a comp whose own `.duration` is 45.045s. This script
 * answers "what does this composition's own top-level timeline actually
 * look like" - comp-level duration/work-area facts, plus every top-level
 * layer's cheapest real facts - without ever needing to render anything,
 * and without the per-layer classification cost that made
 * buildInspectCompositionLayerDetailsScript time out on a composition
 * this size. Genuinely minimal, matching buildFindHostLayersScript's own
 * proven-fast pattern: no `instanceof TextLayer`/`AVLayer` branching, no
 * stretch/timeRemapEnabled/opacity/sourceText reads - only the handful of
 * properties every layer object already carries with no extra AE-engine
 * round-trip (index/name/enabled/inPoint/outPoint/startTime/source
 * identity/source duration). Never breaks early - reports every layer,
 * same as buildFindHostLayersScript.
 */
export function buildDescribeCompositionSummaryScript(aeProjectItemIndex: number, compositionName: string): FixedJsxScript {
  const compIndexLiteral = String(aeProjectItemIndex);
  const compNameLiteral = JSON.stringify(compositionName);
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO DESCRIBE_COMPOSITION_SUMMARY")});
  var __result = null;
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(${compIndexLiteral});
      if (__rawItem instanceof CompItem) {
        __comp = __rawItem;
      }
    } catch (__compLookupError) {
      __comp = null;
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " did not resolve to a composition in this project" });
    } else if (__comp.name !== ${compNameLiteral}) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "project item index " + ${compIndexLiteral} + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + ${compNameLiteral} + "\\" - refusing to report facts about the wrong composition"
      });
    } else {
      var __layers = [];
      for (var __i = 1; __i <= __comp.numLayers; __i++) {
        try {
          var __layer = __comp.layer(__i);
          var __sourceCompositionId = null;
          var __sourceDurationSeconds = null;
          if (__layer.source && (__layer.source instanceof CompItem)) {
            __sourceCompositionId = "comp-" + __layer.source.id;
            __sourceDurationSeconds = __layer.source.duration;
          }
          __layers.push({
            layerIndex: __layer.index,
            layerName: __layer.name,
            enabled: __layer.enabled,
            inPointSeconds: __layer.inPoint,
            outPointSeconds: __layer.outPoint,
            startTimeSeconds: __layer.startTime,
            sourceCompositionId: __sourceCompositionId,
            sourceDurationSeconds: __sourceDurationSeconds
          });
        } catch (__layerReadError) {
          // A single unreadable layer never fails the whole scan - it is
          // simply not reported (same fail-partial posture as every other
          // read-only inspection script in this file).
        }
      }
      __result = JSON.stringify({
        ok: true,
        compDurationSeconds: __comp.duration,
        workAreaStartSeconds: __comp.workAreaStart,
        workAreaDurationSeconds: __comp.workAreaDuration,
        frameRate: __comp.frameRate,
        layers: __layers
      });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * CRITICAL SAFETY FIX (real 2026-09-11 incident, session a7fee3d9): a
 * persisted `aeProjectItemIndex` (in the manifest, in a plan's
 * `render_outputs`, or echoed into any dispatch payload) is only ever a
 * SNAPSHOT of `app.project.item(n)`'s ordinal position at the moment it
 * was captured - `app.project.item(idx)` is positional, 1-based across
 * ALL project items (see this file's own module doc comment), and AE
 * renumbers every later item whenever an EARLIER item is inserted or
 * removed. BUILD_HORIZONTAL_COMPOSITION/BUILD_REELS_COMPOSITION each
 * insert a brand-new top-level composition item - proven, real incident:
 * after a Landscape build, aeProjectItemIndex 48 (persisted for
 * "Scene 1"/comp-1) resolved to "Pre-comp 5" instead. Nothing anywhere in
 * this codebase ever re-scans/refreshes a PRE-EXISTING composition's own
 * aeProjectItemIndex after such an insertion (register-horizontal-
 * composition.ts/register-reels-composition.ts only ever ADD their own
 * new derived manifest entry - see their own doc comments) - so a stale
 * index is a real, expected, un-self-healing drift, not a one-off glitch.
 *
 * This script is the fix: it never trusts a persisted index at all. It
 * resolves the target composition by AE's own PERSISTENT `CompItem.id`
 * (confirmed present on `ae_get_composition`'s real response - see
 * parse-mcp-shapes.ts's own CompositionDetail.compId doc comment - and
 * already how this codebase's own `manifestCompositionId` values are
 * built: `"comp-" + item.id`, never `"comp-" + index`) - an id AE
 * guarantees unique per project and which survives reordering/insertion,
 * unlike the index. Scans every project item fresh, right now, and
 * returns the CURRENT real index alongside the composition's own current
 * name/dimensions/frameRate/duration - callers must use THIS resolved
 * index for the rest of the job, never the one they were given. Fails
 * closed (never guesses/falls back to the stale index) if: no item with
 * the expected id exists any more (composition was deleted/never had a
 * real id), or an item with that id exists but its name no longer
 * matches what the manifest last recorded (a duplicate-name situation, or
 * a manifest confused about which id maps to which composition, is never
 * silently trusted - see this project's own established "ambiguous name"
 * fail-closed precedent in verify-render-composition.ts).
 */
export function buildResolveCompositionIndexScript(expectedCompositionId: number, expectedName: string): FixedJsxScript {
  const expectedIdLiteral = String(expectedCompositionId);
  const expectedNameLiteral = JSON.stringify(expectedName);
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO RESOLVE_COMPOSITION_INDEX")});
  var __result = null;
  try {
    var __found = null;
    var __foundIndex = null;
    for (var __i = 1; __i <= app.project.numItems; __i++) {
      var __candidate = app.project.item(__i);
      if (__candidate instanceof CompItem && __candidate.id === ${expectedIdLiteral}) {
        __found = __candidate;
        __foundIndex = __i;
        break;
      }
    }
    if (__found === null) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "no composition with id " + ${expectedIdLiteral} + " exists in this project (expected name \\"" + ${expectedNameLiteral} + "\\") - it may have been deleted, or this project never assigned that composition a real id"
      });
    } else if (__found.name !== ${expectedNameLiteral}) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "composition id " + ${expectedIdLiteral} + " now has name \\"" + __found.name + "\\", expected \\"" + ${expectedNameLiteral} + "\\" - refusing to trust an id match with a mismatched name"
      });
    } else {
      __result = JSON.stringify({
        ok: true,
        resolvedAeProjectItemIndex: __foundIndex,
        name: __found.name,
        widthPx: __found.width,
        heightPx: __found.height,
        frameRate: __found.frameRate,
        durationSeconds: __found.duration
      });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * Real 2026-09-11 nested-content audit (session a7fee3d9): a full-frame
 * black cut with opacity=100 and no in/out boundary nearby (comp-1600's
 * own "Cam Support"/"Camera 1"/"Back"/"Top"/"Element 3D" layers all
 * proved innocent on THOSE two fronts) is only explainable by something
 * this worker has never read before - transform animation (a layer/
 * camera move that changes what's actually visible even though opacity
 * never changes) or a missing/altered effect (Element 3D is a
 * third-party plugin; its own effect can exist in the project file while
 * its rendering binary is absent from THIS machine).
 *
 * Reads `.numKeys`/`.keyTime(i)`/`.keyValue(i)` on transform.position/
 * scale/rotation/anchorPoint - the EXACT same generic Property API this
 * file's own BUILD_REELS_COMPOSITION/BUILD_HORIZONTAL_COMPOSITION scripts
 * already read (`transform.position.numKeys`/`transform.scale.numKeys`,
 * see the "refusing to overwrite existing animation" guard above) and
 * buildInspectCompositionLayerDetailsScript's own opacity keyframe scan
 * already reads (`layer.opacity.numKeys`/`.keyTime`/`.keyValue`) - never
 * a new, unproven ExtendScript pattern. For a CameraLayer, also reads
 * pointOfInterest/zoom the same generic way (both are ordinary animatable
 * Property objects on a camera, per the same API).
 *
 * Effects are enumerated via the standard `"ADBE Effect Parade"` property
 * group (already the documented read path for pluginReferences - see
 * allowed-inspection-queries.ts's own `layer.property.effects` entry,
 * never previously wired to an actual script until now) - `matchName`
 * proves an effect (e.g. a Video Copilot Element 3D instance) was
 * genuinely APPLIED in the original project file. It does NOT prove the
 * plugin's own rendering binary is currently installed/functional on
 * this specific machine - ExtendScript's effect object exposes no
 * documented "is this plugin missing" flag this worker can rely on
 * without inventing one, so this honestly stops at "applied: yes/no",
 * never a guessed availability verdict.
 */
export function buildInspectLayerTransformScript(aeProjectItemIndex: number, compositionName: string): FixedJsxScript {
  const compIndexLiteral = String(aeProjectItemIndex);
  const compNameLiteral = JSON.stringify(compositionName);
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO INSPECT_LAYER_TRANSFORM")});
  var __result = null;
  function __readAnimatableProp(__prop) {
    try {
      if (__prop.numKeys > 0) {
        var __keys = [];
        for (var __k = 1; __k <= __prop.numKeys; __k++) {
          __keys.push({ timeSeconds: __prop.keyTime(__k), value: __prop.keyValue(__k) });
        }
        return { animated: true, currentValue: __prop.value, keyframes: __keys };
      }
      return { animated: false, currentValue: __prop.value, keyframes: null };
    } catch (__propError) {
      return null;
    }
  }
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(${compIndexLiteral});
      if (__rawItem instanceof CompItem) {
        __comp = __rawItem;
      }
    } catch (__compLookupError) {
      __comp = null;
    }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " did not resolve to a composition in this project" });
    } else if (__comp.name !== ${compNameLiteral}) {
      __result = JSON.stringify({
        ok: false,
        failureReason: "project item index " + ${compIndexLiteral} + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + ${compNameLiteral} + "\\" - refusing to report facts about the wrong composition"
      });
    } else {
      var __layers = [];
      for (var __i = 1; __i <= __comp.numLayers; __i++) {
        try {
          var __layer = __comp.layer(__i);
          var __isCamera = __layer instanceof CameraLayer;
          var __effects = [];
          try {
            var __effectsGroup = __layer.property("ADBE Effect Parade");
            if (__effectsGroup) {
              for (var __e = 1; __e <= __effectsGroup.numProperties; __e++) {
                var __eff = __effectsGroup.property(__e);
                __effects.push({ name: __eff.name, matchName: __eff.matchName, enabled: __eff.enabled });
              }
            }
          } catch (__effectsError) {
            // No effects group on this layer type (e.g. some camera/light
            // configurations) - never fails the rest of the scan.
          }
          __layers.push({
            layerIndex: __layer.index,
            layerName: __layer.name,
            enabled: __layer.enabled,
            threeDLayer: __layer.threeDLayer === true,
            isCameraLayer: __isCamera,
            position: __readAnimatableProp(__layer.transform.position),
            scale: __isCamera ? null : __readAnimatableProp(__layer.transform.scale),
            rotation: __isCamera ? null : __readAnimatableProp(__layer.transform.rotation),
            anchorPoint: __readAnimatableProp(__layer.transform.anchorPoint),
            pointOfInterest: __isCamera ? __readAnimatableProp(__layer.pointOfInterest) : null,
            zoom: __isCamera ? __readAnimatableProp(__layer.zoom) : null,
            effects: __effects
          });
        } catch (__layerReadError) {
          // A single unreadable layer never fails the whole scan - same
          // fail-partial posture as every other read-only inspection
          // script in this file.
        }
      }
      __result = JSON.stringify({ ok: true, layers: __layers });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * Real 2026-09-11 incident (candidate "dro-tempelate-converted-v26.aep",
 * 51 compositions, 50 nested under one top-level scene): checking every
 * composition's own effects one at a time via
 * buildInspectLayerTransformScript (through the dashboard's "Describe Any
 * Composition" diagnostic) would need dozens of separate round trips, AND
 * that diagnostic itself is gated behind an already-executed scene
 * preview (a real mutation) - disproportionate just to check for a
 * third-party plugin dependency before any scene mapping/execution
 * decision has even been made. This script instead scans EVERY
 * composition in the project, and every layer within each, in ONE
 * ae_run_jsx call - all the iteration happens inside AE's own JS engine
 * (no per-composition MCP round trip at all), so it carries none of the
 * "one more round trip per composition" MCP-timeout risk this codebase
 * has hit before (see build-project-facts.ts's own pluginReferences doc
 * comment) - this is a single call regardless of composition count.
 *
 * Purely read-only - never intended to run against a session's real
 * working copy; callers open a disposable scratch copy first (see
 * apps/worker/src/diagnostics/scan-project-effects-cli.ts). Wrapped in
 * app.beginUndoGroup/endUndoGroup for the same auditability convention
 * every other script in this file uses, though nothing here mutates
 * project state.
 *
 * Same effect-enumeration approach as buildInspectLayerTransformScript
 * (the "ADBE Effect Parade" property group, `.matchName`) - proves an
 * effect was genuinely APPLIED in the project file, never that its
 * rendering binary is installed/functional on this machine (see that
 * function's own doc comment for the same honest limitation). Every
 * genuine Adobe-native effect's own matchName is "ADBE "-prefixed (a
 * well-established, consistently observed After Effects scripting
 * convention, not a documented guarantee this worker can cite a single
 * Adobe spec for) - a non-"ADBE "-prefixed matchName (e.g. the real
 * "VIDEOCOPILOT 3DArray" proven for the unrelated Element 3D incident)
 * is strong, but not absolute, evidence of a third-party plugin. This
 * script reports the raw matchName for every effect found and lets the
 * caller apply that judgment - it never itself asserts "plugin-free".
 */
/** Bounds each text layer's reported preview, so the persisted layer inventory stays small on text-heavy templates. */
const LAYER_TEXT_PREVIEW_MAX_LENGTH = 120;

/**
 * Upper bound on the FULL template text captured per text layer
 * (leftover-template-copy gate, 2026-09-18). A whole-project scan carries one
 * of these per text layer, so an unbounded read is a real memory/payload
 * hazard on a template with pathological text. Beyond this the capture is
 * marked truncated and the gate treats it as unverifiable (blocking) rather
 * than comparing a partial string as if it were the whole text.
 */
const LAYER_SOURCE_TEXT_MAX_LENGTH = 10_000;

/** AE scripting's documented TrackMatteType keys. */
const TRACK_MATTE_TYPE_KEYS = ["NO_TRACK_MATTE", "ALPHA", "ALPHA_INVERTED", "LUMA", "LUMA_INVERTED"] as const;

/** AE scripting's documented BlendingMode keys, including AE's own "SILHOUETE_ALPHA" spelling. */
const BLENDING_MODE_KEYS = [
  "NORMAL", "DISSOLVE", "DANCING_DISSOLVE", "DARKEN", "MULTIPLY", "COLOR_BURN", "CLASSIC_COLOR_BURN", "LINEAR_BURN",
  "DARKER_COLOR", "ADD", "LIGHTEN", "SCREEN", "COLOR_DODGE", "CLASSIC_COLOR_DODGE", "LINEAR_DODGE", "LIGHTER_COLOR",
  "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "LINEAR_LIGHT", "VIVID_LIGHT", "PIN_LIGHT", "HARD_MIX", "DIFFERENCE",
  "CLASSIC_DIFFERENCE", "EXCLUSION", "SUBTRACT", "DIVIDE", "HUE", "SATURATION", "COLOR", "LUMINOSITY",
  "STENCIL_ALPHA", "STENCIL_LUMA", "SILHOUETE_ALPHA", "SILHOUETTE_LUMA", "ALPHA_ADD", "LUMINESCENT_PREMUL"
] as const;

export function buildScanProjectPreflightScript(): FixedJsxScript {
  const script = `${JSON_STRINGIFY_POLYFILL}function __readFact(read) {
    try {
      var __value = read();
      return __value === undefined ? null : __value;
    } catch (__readError) {
      return null;
    }
  }
  function __readBooleanFact(read) { var __value = __readFact(read); return typeof __value === "boolean" ? __value : null; }
  function __readNumberFact(read) { var __value = __readFact(read); return typeof __value === "number" && isFinite(__value) ? __value : null; }
  function __readStringFact(read) { var __value = __readFact(read); return typeof __value === "string" ? __value : null; }
  function __enumLabel(enumObject, value, knownKeys) {
    if (enumObject === null || enumObject === undefined) { return null; }
    // AE's native enum objects are not guaranteed to have enumerable keys,
    // so the documented key names are checked directly first.
    for (var __knownIndex = 0; __knownIndex < knownKeys.length; __knownIndex++) {
      if (enumObject[knownKeys[__knownIndex]] === value) { return knownKeys[__knownIndex]; }
    }
    for (var __key in enumObject) {
      if (enumObject[__key] === value) { return __key; }
    }
    return null;
  }
  app.beginUndoGroup(${JSON.stringify("DYO SCAN_PROJECT_EFFECTS")});
  var __result = null;
  try {
    var __compositions = [];
    var __fonts = [];
    var __footage = [];
    for (var __itemIndex = 1; __itemIndex <= app.project.numItems; __itemIndex++) {
      var __item = null;
      try {
        __item = app.project.item(__itemIndex);
      } catch (__itemLookupError) {
        continue;
      }
      if (__item instanceof FootageItem) {
        try {
          __footage.push({
            name: __item.name,
            path: __item.file ? __item.file.fsName : null,
            missing: __item.footageMissing === true
          });
        } catch (__footageReadError) {
          // A single unreadable footage item never fails the whole scan.
        }
        continue;
      }
      if (!(__item instanceof CompItem)) {
        continue;
      }
      var __layers = [];
      for (var __i = 1; __i <= __item.numLayers; __i++) {
        try {
          var __layer = __item.layer(__i);
          try {
            var __sourceText = __layer.sourceText;
            if (__sourceText) {
              var __textDocument = __sourceText.value;
              if (__textDocument && __textDocument.font) {
                __fonts.push(__textDocument.font);
              }
            }
          } catch (__fontReadError) {
            // Not a text layer (or its sourceText is unreadable) - never
            // fails the rest of the scan.
          }
          var __kind = "Unknown";
          var __footageFact = null;
          try {
            if (__layer instanceof TextLayer) { __kind = "TextLayer"; }
            else if (__layer instanceof ShapeLayer) { __kind = "ShapeLayer"; }
            else if (__layer instanceof CameraLayer) { __kind = "CameraLayer"; }
            else if (__layer instanceof LightLayer) { __kind = "LightLayer"; }
            else if (__layer instanceof AVLayer) {
              __kind = "AVLayer";
              var __src = __layer.source;
              if (__src && __src instanceof FootageItem) {
                var __isSolid = false;
                try { __isSolid = __src.mainSource instanceof SolidSource; } catch (__solidError) { __isSolid = false; }
                var __isStill = false;
                try { __isStill = __src.mainSource.isStill === true; } catch (__stillError) { __isStill = false; }
                __footageFact = {
                  hasVideo: __src.hasVideo === true,
                  hasAudio: __src.hasAudio === true,
                  isStill: __isStill,
                  isMissing: __src.footageMissing === true,
                  isSolid: __isSolid,
                  widthPx: __src.width,
                  heightPx: __src.height
                };
              }
            }
          } catch (__kindError) {
            // Layer type could not be determined - stays "Unknown" rather
            // than being guessed, exactly as classify-placeholder.ts expects.
          }
          var __effects = [];
          try {
            var __effectsGroup = __layer.property("ADBE Effect Parade");
            if (__effectsGroup) {
              for (var __e = 1; __e <= __effectsGroup.numProperties; __e++) {
                var __eff = __effectsGroup.property(__e);
                __effects.push({ name: __eff.name, matchName: __eff.matchName, enabled: __eff.enabled });
              }
            }
          } catch (__effectsError) {
            // No effects group on this layer type - never fails the rest of the scan.
          }
          // Read-only layer-role evidence (2026-09-13): track-matte wiring,
          // guide/adjustment/null flags and source identity are what decide
          // whether a surfaced layer is a genuine client slot or a template
          // mechanism (a matte, a pre-rendered hardware pass, a guide). Every
          // fact is read independently and reported as null when this AE
          // version or layer type does not expose it - never guessed.
          var __detail = {
            isTrackMatte: __readBooleanFact(function () { return __layer.isTrackMatte; }),
            hasTrackMatte: __readBooleanFact(function () { return __layer.hasTrackMatte; }),
            trackMatteType: __readFact(function () { return __enumLabel(TrackMatteType, __layer.trackMatteType, ${JSON.stringify(TRACK_MATTE_TYPE_KEYS)}); }),
            trackMatteLayerIndex: __readNumberFact(function () { return __layer.trackMatteLayer ? __layer.trackMatteLayer.index : null; }),
            guideLayer: __readBooleanFact(function () { return __layer.guideLayer; }),
            adjustmentLayer: __readBooleanFact(function () { return __layer.adjustmentLayer; }),
            nullLayer: __readBooleanFact(function () { return __layer.nullLayer; }),
            shy: __readBooleanFact(function () { return __layer.shy; }),
            threeDLayer: __readBooleanFact(function () { return __layer.threeDLayer; }),
            blendingMode: __readFact(function () { return __enumLabel(BlendingMode, __layer.blendingMode, ${JSON.stringify(BLENDING_MODE_KEYS)}); }),
            preserveTransparency: __readBooleanFact(function () { return __layer.preserveTransparency; }),
            parentLayerIndex: __readNumberFact(function () { return __layer.parent ? __layer.parent.index : null; }),
            sourceName: __readStringFact(function () { return __layer.source ? __layer.source.name : null; }),
            sourceCompositionId: __readNumberFact(function () { return __layer.source && __layer.source instanceof CompItem ? __layer.source.id : null; }),
            inPointSeconds: __readNumberFact(function () { return __layer.inPoint; }),
            outPointSeconds: __readNumberFact(function () { return __layer.outPoint; }),
            opacityAtInPoint: __readNumberFact(function () { return __layer.property("ADBE Transform Group").property("ADBE Opacity").valueAtTime(__layer.inPoint, false); }),
            opacityKeyframeCount: __readNumberFact(function () { return __layer.property("ADBE Transform Group").property("ADBE Opacity").numKeys; }),
            textPreview: __readStringFact(function () {
              if (!(__layer instanceof TextLayer)) { return null; }
              var __previewText = __layer.sourceText.value.text;
              return typeof __previewText === "string" ? __previewText.substring(0, ${LAYER_TEXT_PREVIEW_MAX_LENGTH}) : null;
            }),
            // The template layer's own text IN FULL (up to the bound), exactly
            // as authored - never trimmed, folded or normalised, because the
            // leftover-template-copy gate compares it code point for code
            // point against an approved mapping.
            sourceText: __readStringFact(function () {
              if (!(__layer instanceof TextLayer)) { return null; }
              var __fullText = __layer.sourceText.value.text;
              return typeof __fullText === "string" ? __fullText.substring(0, ${LAYER_SOURCE_TEXT_MAX_LENGTH}) : null;
            }),
            sourceTextTruncated: __readBooleanFact(function () {
              if (!(__layer instanceof TextLayer)) { return null; }
              var __fullText = __layer.sourceText.value.text;
              return typeof __fullText === "string" ? __fullText.length > ${LAYER_SOURCE_TEXT_MAX_LENGTH} : null;
            })
          };
          __layers.push({
            layerIndex: __layer.index,
            layerName: __layer.name,
            enabled: __layer.enabled,
            kind: __kind,
            footage: __footageFact,
            effects: __effects,
            detail: __detail
          });
        } catch (__layerReadError) {
          // A single unreadable layer never fails the whole scan.
        }
      }
      __compositions.push({ aeProjectItemIndex: __itemIndex, compositionId: __item.id, compositionName: __item.name, layers: __layers });
    }
    __result = JSON.stringify({ ok: true, compositionCount: app.project.numItems, compositions: __compositions, fonts: __fonts, footage: __footage });
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * The single entry point every caller must use - dispatches on the
 * operation's own `type` (already a closed, Zod-validated discriminated
 * union), so adding a new SceneEditOperationType without a corresponding
 * builder here is a TypeScript error, never a silent fallthrough.
 */
export function buildOperationScript(aeProjectItemIndex: number, compositionName: string, operation: SceneEditOperation): FixedJsxScript {
  switch (operation.type) {
    case "SET_TEXT":
      if (operation.nestedTarget !== null) {
        return buildSetTextNestedScript(operation.nestedTarget, operation.text);
      }
      if (operation.layerIndex === null) {
        throw new Error("SET_TEXT operation has neither layerIndex nor nestedTarget set");
      }
      return buildSetTextScript(aeProjectItemIndex, compositionName, operation.layerIndex, operation.text);
    case "MAP_FOOTAGE":
      if (operation.nestedTarget !== null) {
        return buildMapFootageNestedScript(operation.nestedTarget, operation.assetPath, operation.fit ?? "cover");
      }
      if (operation.layerIndex === null) {
        throw new Error("MAP_FOOTAGE operation has neither layerIndex nor nestedTarget set");
      }
      return buildMapFootageScript(aeProjectItemIndex, compositionName, operation.layerIndex, operation.assetPath, operation.fit ?? "cover");
    case "SET_LAYER_VISIBILITY":
      return buildSetLayerVisibilityScript(aeProjectItemIndex, compositionName, operation);
    case "SET_TIME_REMAP_FREEZE":
      return buildSetTimeRemapFreezeScript(aeProjectItemIndex, compositionName, operation);
    case "SET_DURATION":
      return buildSetDurationScript(aeProjectItemIndex, compositionName, operation);
    case "SET_BRAND_COLOR":
      return buildSetBrandColorScript(aeProjectItemIndex, compositionName, operation);
    case "BUILD_REELS_COMPOSITION":
      return buildBuildReelsCompositionScript(aeProjectItemIndex, compositionName, operation);
    case "BUILD_HORIZONTAL_COMPOSITION":
      return buildBuildHorizontalCompositionScript(aeProjectItemIndex, compositionName, operation);
    default: {
      const exhaustive: never = operation;
      throw new Error(`Unhandled scene edit operation type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * REAL 2026-09-17 INVESTIGATIONS (session 069b5891): the approved Hebrew line
 * "\u05DE\u05D1\u05D9\u05EA DYO App" is proven present in Smartphone_05 "Text 1",
 * yet only " DYO App" and part of the Hebrew word render at 19 s and 21 s; and
 * the replaced screenshot looks horizontally compressed with too much empty
 * space below. The existing inspection scripts do not report masks, track
 * mattes, text boxes, text animators, source pixel size/aspect or effect
 * settings (e.g. a corner pin), so neither cause could be proven.
 *
 * READ-ONLY: reads ONE layer (and its track matte layer, if any) at ONE time -
 * every value via value/valueAtTime/sourceRectAtTime, never setValue, never a
 * save. Every read is individually guarded, so an unsupported property (e.g.
 * trackMatteLayer on an older After Effects) reports null instead of failing
 * the whole description. Enum values are reported by their ExtendScript
 * constant name (e.g. MaskMode.ADD -> "ADD") when recognised.
 */
export function buildDescribeLayerAtTimeScript(
  aeProjectItemIndex: number,
  compositionName: string,
  layerIndex: number,
  timeSeconds: number
): FixedJsxScript {
  const compIndexLiteral = String(aeProjectItemIndex);
  const compNameLiteral = JSON.stringify(compositionName);
  const layerIndexLiteral = String(layerIndex);
  const timeLiteral = String(timeSeconds);
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO DESCRIBE_LAYER_AT_TIME")});
  var __result = null;
  var __t = ${timeLiteral};
  function __safe(__fn) { try { var __v = __fn(); return __v === undefined ? null : __v; } catch (__safeError) { return null; } }
  function __table(__fn) { var __tbl = __safe(__fn); return __tbl === null ? {} : __tbl; }
  var __maskModes = __table(function () { return { NONE: MaskMode.NONE, ADD: MaskMode.ADD, SUBTRACT: MaskMode.SUBTRACT, INTERSECT: MaskMode.INTERSECT, LIGHTEN: MaskMode.LIGHTEN, DARKEN: MaskMode.DARKEN, DIFFERENCE: MaskMode.DIFFERENCE }; });
  var __matteTypes = __table(function () { return { NO_TRACK_MATTE: TrackMatteType.NO_TRACK_MATTE, ALPHA: TrackMatteType.ALPHA, ALPHA_INVERTED: TrackMatteType.ALPHA_INVERTED, LUMA: TrackMatteType.LUMA, LUMA_INVERTED: TrackMatteType.LUMA_INVERTED }; });
  var __justifications = __table(function () { return { LEFT_JUSTIFY: ParagraphJustification.LEFT_JUSTIFY, RIGHT_JUSTIFY: ParagraphJustification.RIGHT_JUSTIFY, CENTER_JUSTIFY: ParagraphJustification.CENTER_JUSTIFY, FULL_JUSTIFY_LASTLINE_LEFT: ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT, FULL_JUSTIFY_LASTLINE_RIGHT: ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT, FULL_JUSTIFY_LASTLINE_CENTER: ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER, FULL_JUSTIFY_LASTLINE_FULL: ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL }; });
  function __enumName(__value, __tbl) {
    if (__value === null || __value === undefined) { return null; }
    for (var __key in __tbl) { if (__tbl[__key] === __value) { return __key; } }
    return String(__value);
  }
  function __valueAt(__prop) { return __safe(function () { return __prop.valueAtTime(__t, false); }); }
  function __isAnimated(__prop) { return __safe(function () { return __prop.numKeys > 0; }); }
  function __shapeBounds(__shape) {
    if (!__shape || !__shape.vertices || __shape.vertices.length === 0) { return null; }
    var __left = __shape.vertices[0][0], __right = __left, __top = __shape.vertices[0][1], __bottom = __top;
    for (var __v = 1; __v < __shape.vertices.length; __v++) {
      var __pt = __shape.vertices[__v];
      if (__pt[0] < __left) { __left = __pt[0]; }
      if (__pt[0] > __right) { __right = __pt[0]; }
      if (__pt[1] < __top) { __top = __pt[1]; }
      if (__pt[1] > __bottom) { __bottom = __pt[1]; }
    }
    return { left: __left, top: __top, right: __right, bottom: __bottom, vertexCount: __shape.vertices.length, closed: __shape.closed === true };
  }
  function __describeMasks(__lyr) {
    var __masks = [];
    var __group = __safe(function () { return __lyr.property("ADBE Mask Parade"); });
    if (!__group) { return __masks; }
    var __count = __safe(function () { return __group.numProperties; }) || 0;
    for (var __m = 1; __m <= __count; __m++) {
      var __mask = __safe(function () { return __group.property(__m); });
      if (!__mask) { continue; }
      var __shapeProp = __safe(function () { return __mask.property("ADBE Mask Shape"); });
      __masks.push({
        index: __m,
        name: __safe(function () { return __mask.name; }),
        mode: __enumName(__safe(function () { return __mask.maskMode; }), __maskModes),
        inverted: __safe(function () { return __mask.inverted; }),
        shapeAnimated: __isAnimated(__shapeProp),
        boundsAtTime: __safe(function () { return __shapeBounds(__shapeProp.valueAtTime(__t, false)); }),
        featherAtTime: __valueAt(__safe(function () { return __mask.property("ADBE Mask Feather"); })),
        opacityAtTime: __valueAt(__safe(function () { return __mask.property("ADBE Mask Opacity"); })),
        expansionAtTime: __valueAt(__safe(function () { return __mask.property("ADBE Mask Offset"); }))
      });
    }
    return __masks;
  }
  function __describeEffects(__lyr) {
    var __effects = [];
    var __group = __safe(function () { return __lyr.property("ADBE Effect Parade"); });
    if (!__group) { return __effects; }
    var __count = __safe(function () { return __group.numProperties; }) || 0;
    for (var __e = 1; __e <= __count; __e++) {
      var __eff = __safe(function () { return __group.property(__e); });
      if (!__eff) { continue; }
      // Each effect's own settings at this time (e.g. a Corner Pin's four
      // corners or a Transform effect's scale) - only plain values, capped.
      var __settings = [];
      var __settingCount = __safe(function () { return __eff.numProperties; }) || 0;
      for (var __q = 1; __q <= __settingCount && __settings.length < 24; __q++) {
        var __setting = __safe(function () { return __eff.property(__q); });
        if (!__setting) { continue; }
        var __settingValue = __valueAt(__setting);
        var __settingType = typeof __settingValue;
        if (__settingType === "number" || __settingType === "boolean" || __settingType === "string" || (__settingValue && __settingValue.length !== undefined && typeof __settingValue[0] === "number")) {
          __settings.push({ name: __safe(function () { return __setting.name; }), matchName: __safe(function () { return __setting.matchName; }), valueAtTime: __settingValue });
        }
      }
      __effects.push({ name: __safe(function () { return __eff.name; }), matchName: __safe(function () { return __eff.matchName; }), enabled: __safe(function () { return __eff.enabled; }), settings: __settings });
    }
    return __effects;
  }
  function __describeLayer(__lyr) {
    var __transform = __safe(function () { return __lyr.transform; });
    return {
      layerIndex: __safe(function () { return __lyr.index; }),
      layerName: __safe(function () { return __lyr.name; }),
      enabled: __safe(function () { return __lyr.enabled; }),
      source: __safe(function () {
        var __src = __lyr.source;
        if (!__src) { return null; }
        return {
          name: __safe(function () { return __src.name; }),
          kind: __src instanceof CompItem ? "composition" : (__safe(function () { return __src.mainSource instanceof SolidSource; }) === true ? "solid" : "footage"),
          width: __safe(function () { return __src.width; }),
          height: __safe(function () { return __src.height; }),
          pixelAspect: __safe(function () { return __src.pixelAspect; }),
          durationSeconds: __safe(function () { return __src.duration; })
        };
      }),
      inPointSeconds: __safe(function () { return __lyr.inPoint; }),
      outPointSeconds: __safe(function () { return __lyr.outPoint; }),
      startTimeSeconds: __safe(function () { return __lyr.startTime; }),
      threeDLayer: __safe(function () { return __lyr.threeDLayer; }),
      parent: __safe(function () { return __lyr.parent ? { layerIndex: __lyr.parent.index, layerName: __lyr.parent.name } : null; }),
      isTrackMatte: __safe(function () { return __lyr.isTrackMatte; }),
      hasTrackMatte: __safe(function () { return __lyr.hasTrackMatte; }),
      trackMatteType: __enumName(__safe(function () { return __lyr.trackMatteType; }), __matteTypes),
      trackMatteLayer: __safe(function () { return __lyr.trackMatteLayer ? { layerIndex: __lyr.trackMatteLayer.index, layerName: __lyr.trackMatteLayer.name } : null; }),
      rectAtTime: __safe(function () { var __r = __lyr.sourceRectAtTime(__t, false); return { left: __r.left, top: __r.top, width: __r.width, height: __r.height }; }),
      transformAtTime: {
        anchorPoint: __valueAt(__safe(function () { return __transform.anchorPoint; })),
        position: __valueAt(__safe(function () { return __transform.position; })),
        scale: __valueAt(__safe(function () { return __transform.scale; })),
        rotation: __valueAt(__safe(function () { return __transform.rotation; })),
        opacity: __valueAt(__safe(function () { return __transform.opacity; }))
      },
      masks: __describeMasks(__lyr),
      effects: __describeEffects(__lyr)
    };
  }
  function __describeText(__lyr) {
    var __textGroup = __safe(function () { return __lyr.property("ADBE Text Properties"); });
    if (!__textGroup) { return null; }
    var __doc = __valueAt(__safe(function () { return __textGroup.property("ADBE Text Document"); }));
    var __animators = [];
    var __animGroup = __safe(function () { return __textGroup.property("ADBE Text Animators"); });
    var __animCount = __animGroup ? (__safe(function () { return __animGroup.numProperties; }) || 0) : 0;
    for (var __a = 1; __a <= __animCount; __a++) {
      var __anim = __safe(function () { return __animGroup.property(__a); });
      if (!__anim) { continue; }
      var __selectors = [];
      var __selGroup = __safe(function () { return __anim.property("ADBE Text Selectors"); });
      var __selCount = __selGroup ? (__safe(function () { return __selGroup.numProperties; }) || 0) : 0;
      for (var __s = 1; __s <= __selCount; __s++) {
        var __sel = __safe(function () { return __selGroup.property(__s); });
        if (!__sel) { continue; }
        __selectors.push({
          name: __safe(function () { return __sel.name; }),
          matchName: __safe(function () { return __sel.matchName; }),
          startAtTime: __valueAt(__safe(function () { return __sel.property("ADBE Text Percent Start"); })),
          endAtTime: __valueAt(__safe(function () { return __sel.property("ADBE Text Percent End"); })),
          offsetAtTime: __valueAt(__safe(function () { return __sel.property("ADBE Text Percent Offset"); }))
        });
      }
      var __animatedProps = [];
      var __propsGroup = __safe(function () { return __anim.property("ADBE Text Animator Properties"); });
      var __propCount = __propsGroup ? (__safe(function () { return __propsGroup.numProperties; }) || 0) : 0;
      for (var __p = 1; __p <= __propCount; __p++) {
        var __ap = __safe(function () { return __propsGroup.property(__p); });
        if (__ap) { __animatedProps.push({ name: __safe(function () { return __ap.name; }), matchName: __safe(function () { return __ap.matchName; }), valueAtTime: __valueAt(__ap) }); }
      }
      __animators.push({ name: __safe(function () { return __anim.name; }), enabled: __safe(function () { return __anim.enabled; }), selectors: __selectors, properties: __animatedProps });
    }
    return {
      textLength: __doc ? __safe(function () { return __doc.text.length; }) : null,
      font: __doc ? __safe(function () { return __doc.font; }) : null,
      fontSize: __doc ? __safe(function () { return __doc.fontSize; }) : null,
      justification: __doc ? __enumName(__safe(function () { return __doc.justification; }), __justifications) : null,
      boxText: __doc ? __safe(function () { return __doc.boxText; }) : null,
      boxTextSize: __doc ? __safe(function () { return __doc.boxText ? __doc.boxTextSize : null; }) : null,
      boxTextPos: __doc ? __safe(function () { return __doc.boxText ? __doc.boxTextPos : null; }) : null,
      animators: __animators
    };
  }
  try {
    var __comp = null;
    try {
      var __rawItem = app.project.item(${compIndexLiteral});
      if (__rawItem instanceof CompItem) { __comp = __rawItem; }
    } catch (__compLookupError) { __comp = null; }
    if (__comp === null) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " did not resolve to a composition in this project" });
    } else if (__comp.name !== ${compNameLiteral}) {
      __result = JSON.stringify({ ok: false, failureReason: "project item index " + ${compIndexLiteral} + " resolved to composition \\"" + __comp.name + "\\", expected \\"" + ${compNameLiteral} + "\\" - refusing to report facts about the wrong composition" });
    } else if (!(${layerIndexLiteral} >= 1 && ${layerIndexLiteral} <= __comp.numLayers)) {
      __result = JSON.stringify({ ok: false, failureReason: "layer index " + ${layerIndexLiteral} + " is outside composition \\"" + __comp.name + "\\" (" + __comp.numLayers + " layers)" });
    } else {
      var __layer = __comp.layer(${layerIndexLiteral});
      var __matte = null;
      if (__safe(function () { return __layer.hasTrackMatte; }) === true) {
        __matte = __safe(function () { return __layer.trackMatteLayer; });
        if (!__matte && __layer.index > 1) { __matte = __safe(function () { return __comp.layer(__layer.index - 1); }); }
      }
      var __facts = {
        timeSeconds: __t,
        composition: { name: __comp.name, width: __safe(function () { return __comp.width; }), height: __safe(function () { return __comp.height; }), pixelAspect: __safe(function () { return __comp.pixelAspect; }), durationSeconds: __safe(function () { return __comp.duration; }) },
        layer: __describeLayer(__layer),
        text: __describeText(__layer),
        matteLayer: __matte ? __describeLayer(__matte) : null
      };
      __result = JSON.stringify({ ok: true, facts: __facts });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({ ok: false, failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError)) });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}

/**
 * REAL 2026-09-17 FINDING (session e0483ad6, brand/typography gate): the
 * template references Arial-BoldMT, HelveticaNeue and HelveticaNeue-Bold, and
 * the Hebrew line's layer reports HelveticaNeue-Bold, yet every rendered frame
 * - including the untouched template's own line - shows a serif face. Nothing
 * checked whether those fonts are installed or substituted by After Effects.
 *
 * READ-ONLY, project-wide: for every text layer of every composition, reads its
 * TextDocument's font and fontObject; for every distinct PostScript name, reads
 * what After Effects finds installed (app.fonts.getFontsByPostScriptName) and
 * whether it is in app.fonts.missingOrSubstitutedFonts. Never setValue, never
 * a save. Status per font: "substituted" if any use renders through a
 * substitute or After Effects lists it as missing/substituted; "installed" if
 * a real (non-substitute) font of that name exists; otherwise "missing";
 * "unknown" when the app.fonts API is unavailable. Helpers are declared at the
 * script's top level (ES3: no function declarations inside blocks).
 */
export function buildDescribeProjectFontsScript(): FixedJsxScript {
  const script = `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO DESCRIBE_PROJECT_FONTS")});
  var __result = null;
  function __safe(__fn) { try { var __v = __fn(); return __v === undefined ? null : __v; } catch (__safeError) { return null; } }
  // REAL 2026-09-17 FINDING (job 2ee2114f): After Effects returned font facts
  // that serialised as true / "HelveticaNeue" but failed === comparisons
  // (wrapper objects), so a substituted font was labelled "installed". Every
  // value is normalised to a primitive here, once, before any comparison.
  function __str(__v) { return __v === null || __v === undefined ? null : String(__v); }
  function __bool(__v) { return __v === null || __v === undefined ? null : String(__v) === "true"; }
  function __fontInfo(__font) {
    if (!__font) { return null; }
    return {
      postScriptName: __str(__safe(function () { return __font.postScriptName; })),
      familyName: __str(__safe(function () { return __font.familyName; })),
      styleName: __str(__safe(function () { return __font.styleName; })),
      isSubstitute: __bool(__safe(function () { return __font.isSubstitute; })),
      isFromAdobeFonts: __bool(__safe(function () { return __font.isFromAdobeFonts; })),
      location: __str(__safe(function () { return __font.location; }))
    };
  }
  try {
    var __apiAvailable = __safe(function () { return app.fonts !== undefined && app.fonts !== null && typeof app.fonts.getFontsByPostScriptName === "function"; }) === true;
    var __byName = {};
    var __order = [];
    var __textLayerCount = 0;
    var __itemCount = __safe(function () { return app.project.numItems; }) || 0;
    for (var __i = 1; __i <= __itemCount; __i++) {
      var __item = __safe(function () { return app.project.item(__i); });
      if (!(__item instanceof CompItem)) { continue; }
      var __layerCount = __safe(function () { return __item.numLayers; }) || 0;
      for (var __l = 1; __l <= __layerCount; __l++) {
        var __layer = __safe(function () { return __item.layer(__l); });
        if (!(__layer instanceof TextLayer)) { continue; }
        __textLayerCount++;
        var __sourceText = __safe(function () { return __layer.property("ADBE Text Properties").property("ADBE Text Document"); });
        var __doc = __safe(function () { return __sourceText.value; });
        var __name = __str(__safe(function () { return __doc.font; }));
        if (!__name) { continue; }
        if (!__byName.hasOwnProperty(__name)) {
          __byName[__name] = { postScriptName: __name, usedBy: [], usageCount: 0 };
          __order.push(__name);
        }
        __byName[__name].usageCount++;
        if (__byName[__name].usedBy.length < 20) {
          __byName[__name].usedBy.push({
            composition: __safe(function () { return __item.name; }),
            layerIndex: __safe(function () { return __layer.index; }),
            layerName: __safe(function () { return __layer.name; }),
            sourceTextKeyframed: __bool(__safe(function () { return __sourceText.numKeys > 0; })),
            renderedWith: __fontInfo(__safe(function () { return __doc.fontObject; }))
          });
        }
      }
    }
    var __missingOrSubstituted = [];
    if (__apiAvailable) {
      var __listed = __safe(function () { return app.fonts.missingOrSubstitutedFonts; });
      var __listedCount = __listed ? (__safe(function () { return __listed.length; }) || 0) : 0;
      for (var __m = 0; __m < __listedCount; __m++) { __missingOrSubstituted.push(__fontInfo(__listed[__m])); }
    }
    var __fonts = [];
    for (var __f = 0; __f < __order.length; __f++) {
      var __entry = __byName[__order[__f]];
      var __installed = [];
      if (__apiAvailable) {
        var __matches = __safe(function () { return app.fonts.getFontsByPostScriptName(__entry.postScriptName); });
        var __matchCount = __matches ? (__safe(function () { return __matches.length; }) || 0) : 0;
        for (var __k = 0; __k < __matchCount; __k++) { __installed.push(__fontInfo(__matches[__k])); }
      }
      var __rendersThroughSubstitute = false;
      for (var __u = 0; __u < __entry.usedBy.length; __u++) {
        if (__entry.usedBy[__u].renderedWith && __entry.usedBy[__u].renderedWith.isSubstitute === true) { __rendersThroughSubstitute = true; }
      }
      var __listedAsMissing = false;
      for (var __s = 0; __s < __missingOrSubstituted.length; __s++) {
        if (__missingOrSubstituted[__s] && __missingOrSubstituted[__s].postScriptName === __entry.postScriptName) { __listedAsMissing = true; }
      }
      var __realInstalled = false;
      for (var __r = 0; __r < __installed.length; __r++) {
        if (__installed[__r] && __installed[__r].isSubstitute !== true) { __realInstalled = true; }
      }
      var __status = !__apiAvailable ? "unknown" : (__rendersThroughSubstitute || __listedAsMissing) ? "substituted" : __realInstalled ? "installed" : "missing";
      __fonts.push({ postScriptName: __entry.postScriptName, status: __status, usageCount: __entry.usageCount, usedBy: __entry.usedBy, installed: __installed });
    }
    __result = JSON.stringify({ ok: true, facts: { fontsApiAvailable: __apiAvailable, textLayerCount: __textLayerCount, fonts: __fonts, missingOrSubstitutedFonts: __missingOrSubstituted } });
  } catch (__unexpectedError) {
    __result = JSON.stringify({ ok: false, failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError)) });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
  return script as FixedJsxScript;
}
