import type { SceneEditOperation } from "@dyo/schemas";

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
  const script = `app.beginUndoGroup(${JSON.stringify(`DYO EXECUTE_FRAME: ${operationLabel}`)});
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

function buildSetTextScript(aeProjectItemIndex: number, compositionName: string, op: Extract<SceneEditOperation, { type: "SET_TEXT" }>): FixedJsxScript {
  const text = JSON.stringify(op.text);
  const body = `
        if (!(__layer instanceof TextLayer)) {
          __result = JSON.stringify({ ok: false, failureReason: "target layer is not a text layer" });
        } else {
          var __td = __layer.sourceText.value;
          var __previousText = __td.text;
          __td.text = ${text};
          __layer.sourceText.setValue(__td);
          __result = JSON.stringify({ ok: true, previousValue: __previousText, resultingValue: ${text} });
        }`;
  return withTargets(wrapScript("SET_TEXT", body), aeProjectItemIndex, compositionName, op.layerIndex) as FixedJsxScript;
}

function buildMapFootageScript(aeProjectItemIndex: number, compositionName: string, op: Extract<SceneEditOperation, { type: "MAP_FOOTAGE" }>): FixedJsxScript {
  const assetPath = JSON.stringify(op.assetPath);
  const body = `
        if (!(__layer instanceof AVLayer)) {
          __result = JSON.stringify({ ok: false, failureReason: "target layer is not an AV layer" });
        } else {
          var __assetFile = new File(${assetPath});
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
  return withTargets(wrapScript("MAP_FOOTAGE", body), aeProjectItemIndex, compositionName, op.layerIndex) as FixedJsxScript;
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
  const script = `app.beginUndoGroup(${JSON.stringify("DYO EXECUTE_FRAME: SAVE_PROJECT")});
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
  const script = `app.beginUndoGroup(${JSON.stringify("DYO INSPECT_RENDER_CAPABILITIES")});
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
 * The single entry point every caller must use - dispatches on the
 * operation's own `type` (already a closed, Zod-validated discriminated
 * union), so adding a new SceneEditOperationType without a corresponding
 * builder here is a TypeScript error, never a silent fallthrough.
 */
export function buildOperationScript(aeProjectItemIndex: number, compositionName: string, operation: SceneEditOperation): FixedJsxScript {
  switch (operation.type) {
    case "SET_TEXT":
      return buildSetTextScript(aeProjectItemIndex, compositionName, operation);
    case "MAP_FOOTAGE":
      return buildMapFootageScript(aeProjectItemIndex, compositionName, operation);
    case "SET_LAYER_VISIBILITY":
      return buildSetLayerVisibilityScript(aeProjectItemIndex, compositionName, operation);
    case "SET_TIME_REMAP_FREEZE":
      return buildSetTimeRemapFreezeScript(aeProjectItemIndex, compositionName, operation);
    case "SET_DURATION":
      return buildSetDurationScript(aeProjectItemIndex, compositionName, operation);
    case "SET_BRAND_COLOR":
      return buildSetBrandColorScript(aeProjectItemIndex, compositionName, operation);
    default: {
      const exhaustive: never = operation;
      throw new Error(`Unhandled scene edit operation type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
