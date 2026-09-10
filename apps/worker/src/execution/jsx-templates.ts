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

/** Shared mutation body for SET_TEXT - identical for the flat and nested target cases, since both resolve down to the same `__layer` variable before this runs. */
function buildSetTextBody(text: string): string {
  const textLiteral = JSON.stringify(text);
  return `
        if (!(__layer instanceof TextLayer)) {
          __result = JSON.stringify({ ok: false, failureReason: "target layer is not a text layer" });
        } else {
          var __td = __layer.sourceText.value;
          var __previousText = __td.text;
          __td.text = ${textLiteral};
          __layer.sourceText.setValue(__td);
          __result = JSON.stringify({ ok: true, previousValue: __previousText, resultingValue: ${textLiteral} });
        }`;
}

/** Shared mutation body for MAP_FOOTAGE - identical for the flat and nested target cases (module doc comment on buildSetTextBody above). */
function buildMapFootageBody(assetPath: string): string {
  const assetPathLiteral = JSON.stringify(assetPath);
  return `
        if (!(__layer instanceof AVLayer)) {
          __result = JSON.stringify({ ok: false, failureReason: "target layer is not an AV layer" });
        } else {
          var __assetFile = new File(${assetPathLiteral});
          if (!__assetFile.exists) {
            __result = JSON.stringify({ ok: false, failureReason: "asset file does not exist on the worker filesystem: " + __assetFile.fsName });
          } else {
            var __previousSourceName = (__layer.source && __layer.source.name) ? __layer.source.name : null;
            var __importOptions = new ImportOptions(__assetFile);
            var __newFootageItem = app.project.importFile(__importOptions);
            __layer.replaceSource(__newFootageItem, false);
            __result = JSON.stringify({ ok: true, previousValue: __previousSourceName, resultingValue: __newFootageItem.name });
          }
        }`;
}

function buildSetTextScript(aeProjectItemIndex: number, compositionName: string, layerIndex: number, text: string): FixedJsxScript {
  return withTargets(wrapScript("SET_TEXT", buildSetTextBody(text)), aeProjectItemIndex, compositionName, layerIndex) as FixedJsxScript;
}

function buildMapFootageScript(aeProjectItemIndex: number, compositionName: string, layerIndex: number, assetPath: string): FixedJsxScript {
  return withTargets(wrapScript("MAP_FOOTAGE", buildMapFootageBody(assetPath)), aeProjectItemIndex, compositionName, layerIndex) as FixedJsxScript;
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
      const resolveBlock = `
      if (__pathFailureReason === null) {
        var __stepComp = null;
        try {
          var __stepRawItem = app.project.item(${compIndexLiteral});
          if (__stepRawItem instanceof CompItem) { __stepComp = __stepRawItem; }
        } catch (__stepLookupError) { __stepComp = null; }
        if (__stepComp === null) {
          __pathFailureReason = "nested target step ${index}: project item index ${compIndexLiteral} did not resolve to a composition in this project";
        } else if (__stepComp.id !== ${numericIdLiteral}) {
          __pathFailureReason = "nested target step ${index}: project item index ${compIndexLiteral} resolved to composition id " + __stepComp.id + " (name \\"" + __stepComp.name + "\\"), expected id ${numericIdLiteral} (\\"${compIdForMessage}\\") - stale or broken nested path, refusing to guess";
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

function buildMapFootageNestedScript(nestedTarget: readonly ResolvedNestedTargetStep[], assetPath: string): FixedJsxScript {
  return wrapNestedScript("MAP_FOOTAGE", buildMapFootageBody(assetPath), nestedTarget);
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
        return buildMapFootageNestedScript(operation.nestedTarget, operation.assetPath);
      }
      if (operation.layerIndex === null) {
        throw new Error("MAP_FOOTAGE operation has neither layerIndex nor nestedTarget set");
      }
      return buildMapFootageScript(aeProjectItemIndex, compositionName, operation.layerIndex, operation.assetPath);
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
