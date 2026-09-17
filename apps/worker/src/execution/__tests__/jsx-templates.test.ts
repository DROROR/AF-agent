import vm from "node:vm";
import { describe, expect, it } from "vitest";
import type { SceneEditOperation } from "@dyo/schemas";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildOperationScript,
  buildSaveProjectScript,
  buildInspectRenderCapabilitiesScript,
  buildInspectCompositionPrecompsScript,
  buildInspectCompositionLayerDetailsScript,
  buildFindHostLayersScript,
  buildDescribeCompositionSummaryScript,
  buildInspectLayerTransformScript,
  buildScanProjectPreflightScript,
  buildOpenProjectScript,
  buildReopenProjectFromDiskScript,
  buildInspectTextLayerClippingScript
} from "../jsx-templates.js";

const COMP_NAME = "Test Comp";

/**
 * Genuinely reproduces the real 2026-09-02 production failure
 * ("INSPECT_RENDER_CAPABILITIES -> TOOL_ERROR / AE_ERROR: 'JSON is
 * undefined'") and proves the fix: runs a built FixedJsxScript in a fresh
 * V8 realm (via node:vm) with its own `JSON` global explicitly undefined
 * BEFORE the script runs - the closest a Node-based test can get to
 * ExtendScript's real, well-documented absence of a native JSON object
 * (V8 itself always provides one to any new context/realm; ExtendScript's
 * actual engine does not, which is the real root cause - see
 * JSON_STRINGIFY_POLYFILL's own doc comment in jsx-templates.ts).
 * Invokes the script EXACTLY the way the real upstream ae_run_jsx tool
 * does (`new Function("args", code)`, then calls the result) - not a
 * wrapped/adapted invocation - so this is a faithful reproduction of the
 * real failure mode, not a weaker approximation of it.
 *
 * `setupScript` (if given) runs first, in the SAME context, to construct
 * fake `app`/`CompItem` globals natively INSIDE this realm - deliberately
 * never passed in as plain host-realm JS objects, since arrays/instances
 * created in the outer Node realm fail `instanceof`/array checks against
 * this context's own (separate) intrinsics; a real AE process has no such
 * multi-realm split at all, so this is purely a test-construction detail,
 * not something the actual script logic needs to account for.
 */
function runFixedScriptWithoutNativeJson(script: string, setupScript = ""): string {
  const context = vm.createContext({});
  // Simulates ExtendScript's real absence of a JSON global - see this
  // function's own doc comment above for why `vm` itself cannot omit it
  // from context creation, only undefine it afterward.
  vm.runInContext("JSON = undefined;", context);
  if (setupScript) {
    vm.runInContext(setupScript, context);
  }
  return vm.runInContext(`(new Function("args", ${JSON.stringify(script)}))()`, context) as string;
}

/** Fake app/CompItem/render-queue object model, built as ExtendScript-like source text so it is constructed natively inside the same vm realm the script under test runs in (see runFixedScriptWithoutNativeJson's own doc comment on why). */
const FAKE_RENDER_CAPABILITIES_APP_SETUP = `
  function CompItem() {}
  var __fakeComp = new CompItem();
  __fakeComp.name = ${JSON.stringify(COMP_NAME)};
  var __fakeRenderQueueItem = {
    templates: ["Best Settings", "Custom Preset"],
    outputModule: function () { return { templates: ["Lossless", "H.264 - Match Render Settings"] }; },
    remove: function () {}
  };
  var app = {
    beginUndoGroup: function () {},
    endUndoGroup: function () {},
    project: {
      numItems: 1,
      item: function (i) { return i === 1 ? __fakeComp : null; },
      renderQueue: { items: { add: function () { return __fakeRenderQueueItem; } } }
    }
  };
`;

describe("buildOperationScript", () => {
  it("is deterministic - the same operation always produces byte-identical JSX", () => {
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 3, nestedTarget: null, text: "Hello" };
    const a = buildOperationScript(2, COMP_NAME, op);
    const b = buildOperationScript(2, COMP_NAME, op);
    expect(a).toBe(b);
  });

  it("is a bare function BODY, never a self-invoking (function(){...})() expression - regression test for the real ae_run_jsx contract (new Function('args', code))", () => {
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: "x" };
    const script = buildOperationScript(0, COMP_NAME, op);
    expect(script).not.toMatch(/^\s*\(function\s*\(/);
    expect(script).not.toMatch(/\}\)\(\)\s*$/);
    expect(script.trim().endsWith("return __result;")).toBe(true);
    const saveScript = buildSaveProjectScript();
    expect(saveScript).not.toMatch(/^\s*\(function\s*\(/);
    expect(saveScript.trim().endsWith("return __result;")).toBe(true);
  });

  it("wraps every operation in beginUndoGroup/try/finally/endUndoGroup", () => {
    const ops: SceneEditOperation[] = [
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: "x" },
      { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, assetPath: "/tmp/a.png" },
      { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 1, visible: true },
      { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-1", layerIndex: 1, freezeAtSeconds: 1 },
      { type: "SET_DURATION", manifestPlaceholderId: "ph-1", layerIndex: 1, durationSeconds: 3 },
      { type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 1, colorHex: "#112233" }
    ];
    for (const op of ops) {
      const script = buildOperationScript(0, COMP_NAME, op);
      expect(script).toContain("app.beginUndoGroup(");
      expect(script).toContain("app.endUndoGroup();");
      expect(script).toContain("try {");
      expect(script).toContain("finally {");
    }
  });

  it("resolves the composition via a direct, raw 1-based app.project.item(idx) lookup - the same convention ae_get_composition/ae_get_layer's own comp_index uses - never a 0-based 'count only CompItems' scan", () => {
    const op: SceneEditOperation = { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 2, visible: false };
    const script = buildOperationScript(5, COMP_NAME, op);
    expect(script).toContain("app.project.item(5)");
    expect(script).toContain("__rawItem instanceof CompItem");
    // Regression guard: the old (wrong) 0-based CompItem-counting scan must never reappear.
    expect(script).not.toContain("__compCount");
    expect(script).toContain("__comp.layer(2)");
  });

  it("verifies the resolved composition's own name against the expected compositionName BEFORE any mutation - a typed failure, never a guess, on mismatch", () => {
    const op: SceneEditOperation = { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 2, visible: false };
    const script = buildOperationScript(5, "Scene 03", op);
    expect(script).toContain(JSON.stringify("Scene 03"));
    expect(script).toContain("__comp.name !==");
    expect(script).toContain("refusing to mutate the wrong composition");
    // The name check must happen BEFORE the layer lookup/mutation body - never after.
    const nameCheckPos = script.indexOf("__comp.name !==");
    const layerLookupPos = script.indexOf("__comp.layer(");
    expect(nameCheckPos).toBeGreaterThan(-1);
    expect(layerLookupPos).toBeGreaterThan(nameCheckPos);
  });

  it("never breaks out of its string literal for a malicious text value (JSON.stringify escaping)", () => {
    const malicious = '"; app.quit(); var x = "';
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: malicious };
    const script = buildOperationScript(0, COMP_NAME, op);
    // The malicious payload must appear only inside a properly escaped
    // JSON string literal (backslash-escaped quotes), never as a bare
    // unescaped `app.quit()` call sitting outside any string.
    expect(script).not.toMatch(/[^\\]"; app\.quit\(\); var x = "[^\\]/);
    expect(script).toContain(JSON.stringify(malicious));
  });

  it("never breaks out via a backslash/newline/unicode-heavy text value", () => {
    const nasty = 'line1\nline2\\backslash  "quote"';
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: nasty };
    // Must not throw, and must produce valid embeddable JSON for the value.
    const script = buildOperationScript(0, COMP_NAME, op);
    expect(script).toContain(JSON.stringify(nasty));
  });

  it("SET_TEXT preserves style by mutating only sourceText.value.text, never replacing the whole TextDocument", () => {
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: "שלום" };
    const script = buildOperationScript(0, COMP_NAME, op);
    expect(script).toContain("__layer instanceof TextLayer");
    expect(script).toContain("__layer.sourceText.value");
    expect(script).toContain("__td.text =");
    expect(script).toContain("__layer.sourceText.setValue(__td)");
    // Hebrew text survives JSON.stringify's escaping unchanged (JSON.stringify
    // does not mangle non-ASCII characters by default in this JS engine).
    expect(script).toContain(JSON.stringify("שלום"));
  });

  it("MAP_FOOTAGE checks AVLayer, file existence, and uses replaceSource - never a global footage-by-name replacement", () => {
    const op: SceneEditOperation = { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 4, nestedTarget: null, assetPath: "/safe/local/clip.mp4" };
    const script = buildOperationScript(1, COMP_NAME, op);
    expect(script).toContain("__layer instanceof AVLayer");
    expect(script).toContain("new File(" + JSON.stringify("/safe/local/clip.mp4") + ")");
    expect(script).toContain("__assetFile.exists");
    expect(script).toContain("app.project.importFile(__importOptions)");
    expect(script).toContain("__layer.replaceSource(__newFootageItem, false)");
  });

  it("SET_TIME_REMAP_FREEZE validates canSetTimeRemapEnabled before mutating, and clears existing keyframes deterministically", () => {
    const op: SceneEditOperation = { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-1", layerIndex: 1, freezeAtSeconds: 2.5 };
    const script = buildOperationScript(0, COMP_NAME, op);
    expect(script).toContain("__layer.canSetTimeRemapEnabled");
    expect(script).toContain("__layer.timeRemapEnabled = true");
    expect(script).toContain("__timeRemapProp.removeKey(1)");
    expect(script).toContain("__timeRemapProp.setValue(2.5)");
  });

  it("SET_DURATION sets the layer's outPoint relative to its own inPoint, never the composition duration", () => {
    const op: SceneEditOperation = { type: "SET_DURATION", manifestPlaceholderId: "ph-1", layerIndex: 1, durationSeconds: 6 };
    const script = buildOperationScript(0, COMP_NAME, op);
    expect(script).toContain("__layer.outPoint = __layer.inPoint + 6");
    expect(script).not.toContain("__comp.duration =");
  });

  it("SET_BRAND_COLOR only supports a SolidSource, converts hex to a 0-1 RGB triple, and rejects other layer types with a typed failure path", () => {
    const op: SceneEditOperation = { type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 1, colorHex: "#FF8000" };
    const script = buildOperationScript(0, COMP_NAME, op);
    expect(script).toContain("__layer.source instanceof SolidSource");
    expect(script).toContain("only supports solid-color layers");
    // #FF8000 -> [1, 0.50196..., 0]
    expect(script).toContain(JSON.stringify([1, 128 / 255, 0]));
  });

  it("every operation type produces a distinct script", () => {
    const ops: SceneEditOperation[] = [
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: "x" },
      { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, assetPath: "/a.png" },
      { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 1, visible: true },
      { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-1", layerIndex: 1, freezeAtSeconds: 1 },
      { type: "SET_DURATION", manifestPlaceholderId: "ph-1", layerIndex: 1, durationSeconds: 3 },
      { type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 1, colorHex: "#112233" }
    ];
    const scripts = ops.map((op) => buildOperationScript(0, COMP_NAME, op));
    expect(new Set(scripts).size).toBe(scripts.length);
  });

  it("buildSaveProjectScript saves in place via app.project.save() - never saveWithDialog or a caller-supplied path", () => {
    const script = buildSaveProjectScript();
    expect(script).toContain("app.project.save()");
    expect(script).not.toContain("saveWithDialog");
    expect(script).toContain("app.beginUndoGroup(");
    expect(script).toContain("app.endUndoGroup();");
  });

  it("the returned value is a real JS string at runtime despite the branded type", () => {
    const op: SceneEditOperation = { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 1, visible: true };
    const script = buildOperationScript(0, COMP_NAME, op);
    expect(typeof script).toBe("string");
  });
});

describe("buildInspectRenderCapabilitiesScript", () => {
  it("never saves the project and never calls app.project.save()", () => {
    const script = buildInspectRenderCapabilitiesScript();
    expect(script).not.toContain("app.project.save()");
  });

  it("is a bare function BODY, never a self-invoking expression", () => {
    const script = buildInspectRenderCapabilitiesScript();
    expect(script).not.toMatch(/^\s*\(function\s*\(/);
    expect(script.trim().endsWith("return __result;")).toBe(true);
  });

  it("wraps in beginUndoGroup/try/finally/endUndoGroup like every other script", () => {
    const script = buildInspectRenderCapabilitiesScript();
    expect(script).toContain("app.beginUndoGroup(");
    expect(script).toContain("app.endUndoGroup();");
    expect(script).toContain("try {");
    expect(script).toContain("finally {");
  });

  it("always removes the temporary render-queue item it adds, even on the failure path", () => {
    const script = buildInspectRenderCapabilitiesScript();
    expect(script).toContain("app.project.renderQueue.items.add(");
    expect(script).toContain("__tempItem.remove()");
    // The removal happens inside the finally block, not conditionally on success only.
    const finallyIndex = script.indexOf("} finally {");
    const removeIndex = script.indexOf("__tempItem.remove()");
    expect(removeIndex).toBeGreaterThan(finallyIndex);
  });

  it("is deterministic", () => {
    expect(buildInspectRenderCapabilitiesScript()).toBe(buildInspectRenderCapabilitiesScript());
  });
});

describe("real production bug fix (2026-09-02): 'JSON is undefined' can never recur - every script installs a JSON.stringify shim before it is ever called", () => {
  const allBuiltScripts = (): { name: string; script: string }[] => [
    { name: "SET_TEXT", script: buildOperationScript(1, COMP_NAME, { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: "x" }) },
    { name: "MAP_FOOTAGE", script: buildOperationScript(1, COMP_NAME, { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, assetPath: "/tmp/a.png" }) },
    { name: "SET_LAYER_VISIBILITY", script: buildOperationScript(1, COMP_NAME, { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 1, visible: true }) },
    { name: "SET_TIME_REMAP_FREEZE", script: buildOperationScript(1, COMP_NAME, { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-1", layerIndex: 1, freezeAtSeconds: 1 }) },
    { name: "SET_DURATION", script: buildOperationScript(1, COMP_NAME, { type: "SET_DURATION", manifestPlaceholderId: "ph-1", layerIndex: 1, durationSeconds: 3 }) },
    { name: "SET_BRAND_COLOR", script: buildOperationScript(1, COMP_NAME, { type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 1, colorHex: "#112233" }) },
    {
      name: "BUILD_REELS_COMPOSITION",
      script: buildOperationScript(1, COMP_NAME, {
        type: "BUILD_REELS_COMPOSITION",
        reelsCompositionName: "Reels",
        layerTransforms: [{ layerIndex: 1, manifestPlaceholderId: null, positionX: 0, positionY: 0, scalePercent: 100 }]
      })
    },
    { name: "SAVE_PROJECT", script: buildSaveProjectScript() },
    { name: "INSPECT_RENDER_CAPABILITIES", script: buildInspectRenderCapabilitiesScript() },
    { name: "INSPECT_COMPOSITION_PRECOMPS", script: buildInspectCompositionPrecompsScript(1, COMP_NAME) },
    { name: "INSPECT_COMPOSITION_LAYER_DETAILS", script: buildInspectCompositionLayerDetailsScript(1, COMP_NAME) }
  ];

  it("every script this file builds installs the JSON.stringify shim BEFORE app.beginUndoGroup - so it is guaranteed to exist before any of the script's own logic runs", () => {
    for (const { name, script } of allBuiltScripts()) {
      const shimIndex = script.indexOf('if (typeof JSON === "undefined")');
      const beginUndoGroupIndex = script.indexOf("app.beginUndoGroup(");
      expect(shimIndex, `${name}: shim not found`).toBeGreaterThan(-1);
      expect(beginUndoGroupIndex, `${name}: app.beginUndoGroup not found`).toBeGreaterThan(-1);
      expect(shimIndex, `${name}: shim must come before app.beginUndoGroup`).toBeLessThan(beginUndoGroupIndex);
    }
  });

  it("REPRODUCES the exact real production failure and proves the fix: buildInspectRenderCapabilitiesScript(), run in a realm with no native JSON (simulating ExtendScript), throws WITHOUT the shim and succeeds WITH it", () => {
    const script = buildInspectRenderCapabilitiesScript();

    // Without the shim (the pre-fix script text), this throws - the exact
    // real production failure. Proven by stripping the shim back out of
    // an otherwise-identical copy of the real, current script.
    const scriptWithoutShim = script.replace(
      /if \(typeof JSON === "undefined"\)[\s\S]*?\n\s*\}\n\s*app\.beginUndoGroup/,
      "app.beginUndoGroup"
    );
    expect(scriptWithoutShim).not.toBe(script);
    expect(() => runFixedScriptWithoutNativeJson(scriptWithoutShim, FAKE_RENDER_CAPABILITIES_APP_SETUP)).toThrow();

    // With the shim (the real, current script) - no throw, and a real,
    // valid, correctly-shaped JSON result.
    const resultText = runFixedScriptWithoutNativeJson(script, FAKE_RENDER_CAPABILITIES_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result).toEqual({
      ok: true,
      renderSettingsTemplateNames: ["Best Settings", "Custom Preset"],
      outputModuleTemplateNames: ["Lossless", "H.264 - Match Render Settings"]
    });
  });

  it("the shim correctly serializes strings with special characters (quotes, backslashes, newlines, control characters) - not just simple values", () => {
    const script = buildInspectRenderCapabilitiesScript();
    const shimOnly = script.slice(0, script.indexOf("app.beginUndoGroup"));
    const probe = `${shimOnly}return JSON.stringify({ text: "a \\"quote\\", a \\\\backslash\\\\, a\\nnewline, a\\tinvisible tab" });`;
    const resultText = runFixedScriptWithoutNativeJson(probe);
    expect(JSON.parse(resultText)).toEqual({ text: 'a "quote", a \\backslash\\, a\nnewline, a\tinvisible tab' });
  });

  it("the shim correctly serializes arrays, nested objects, numbers, booleans, and null - the exact shapes these scripts actually produce", () => {
    const script = buildInspectRenderCapabilitiesScript();
    const shimOnly = script.slice(0, script.indexOf("app.beginUndoGroup"));
    const probe = `${shimOnly}return JSON.stringify({ ok: true, list: ["a", "b"], nested: { n: 1, b: true, z: null }, arr: [1,2,3] });`;
    const resultText = runFixedScriptWithoutNativeJson(probe);
    expect(JSON.parse(resultText)).toEqual({ ok: true, list: ["a", "b"], nested: { n: 1, b: true, z: null }, arr: [1, 2, 3] });
  });

  it("never overwrites a real, working native JSON.stringify - only installs the shim when one is genuinely missing (defensive, in case a future ExtendScript version does provide one)", () => {
    const script = buildInspectRenderCapabilitiesScript();
    const shimOnly = script.slice(0, script.indexOf("app.beginUndoGroup"));
    const context = vm.createContext({});
    // Leaves the real native JSON in place this time (does not undefine it).
    const resultText = vm.runInContext(
      `(new Function("args", ${JSON.stringify(`${shimOnly}return JSON.stringify({ probe: "native-json-still-used" });`)}))()`,
      context
    ) as string;
    expect(JSON.parse(resultText)).toEqual({ probe: "native-json-still-used" });
  });
});

describe("buildInspectCompositionLayerDetailsScript (live-QA generic AE layer-discovery capability)", () => {
  /**
   * Fake TextLayer/AVLayer/CompItem object model exercising the exact
   * classification order the real script relies on (TextLayer checked
   * BEFORE AVLayer, since TextLayer is itself a subtype of AVLayer in the
   * real AE DOM) - built natively inside the vm realm, same rationale as
   * FAKE_RENDER_CAPABILITIES_APP_SETUP above.
   */
  const FAKE_LAYER_DETAILS_APP_SETUP = `
    function CompItem() {}
    function AVLayer() {}
    AVLayer.prototype = Object.create(CompItem.prototype);
    // TextLayer is itself a subtype of AVLayer in the real AE DOM - mirrored
    // here so "instanceof TextLayer" checked BEFORE "instanceof AVLayer" is
    // the only thing that keeps a real text layer from being misclassified.
    function TextLayer() {}
    TextLayer.prototype = new AVLayer();

    var __precompSource = new CompItem();
    __precompSource.id = 4242;

    var __textLayer = new TextLayer();
    __textLayer.index = 1;
    __textLayer.name = "Hebrew Branding";
    __textLayer.sourceText = { value: { text: "מבית DYO App" } };

    var __precompLayer = new AVLayer();
    __precompLayer.index = 2;
    __precompLayer.name = "Nested Comp Ref";
    __precompLayer.source = __precompSource;

    var __avLayer = new AVLayer();
    __avLayer.index = 3;
    __avLayer.name = "Footage Layer";

    var __shapeLayer = {};
    __shapeLayer.index = 4;
    __shapeLayer.name = "Shape Layer";

    var __unreadableLayer = {};
    __unreadableLayer.index = 5;
    Object.defineProperty(__unreadableLayer, "name", { get: function () { throw new Error("boom"); } });

    var __staticOpacityLayer = new AVLayer();
    __staticOpacityLayer.index = 6;
    __staticOpacityLayer.name = "Static Zero Opacity Layer";
    __staticOpacityLayer.opacity = { numKeys: 0, value: 0 };

    var __keyframedOpacityLayer = new AVLayer();
    __keyframedOpacityLayer.index = 7;
    __keyframedOpacityLayer.name = "Fading Layer";
    __keyframedOpacityLayer.opacity = {
      numKeys: 3,
      keyTime: function (i) { return [null, 1, 2.5, 4][i]; },
      keyValue: function (i) { return [null, 0, 100, 0][i]; }
    };

    var __fakeComp = new CompItem();
    __fakeComp.name = ${JSON.stringify(COMP_NAME)};
    __fakeComp.numLayers = 7;
    var __layersByIndex = { 1: __textLayer, 2: __precompLayer, 3: __avLayer, 4: __shapeLayer, 5: __unreadableLayer, 6: __staticOpacityLayer, 7: __keyframedOpacityLayer };
    __fakeComp.layer = function (i) { return __layersByIndex[i]; };

    var app = {
      beginUndoGroup: function () {},
      endUndoGroup: function () {},
      project: { item: function (i) { return i === 1 ? __fakeComp : null; } }
    };
  `;

  it("classifies TEXT (with real sourceText), PRECOMP (with real sourceCompositionId), AV, and OTHER layers correctly, and skips an unreadable layer without failing the whole result", () => {
    const script = buildInspectCompositionLayerDetailsScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, FAKE_LAYER_DETAILS_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result).toEqual({
      ok: true,
      layerDetails: [
        { layerIndex: 1, layerName: "Hebrew Branding", layerType: "TEXT", sourceText: "מבית DYO App", sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        { layerIndex: 2, layerName: "Nested Comp Ref", layerType: "PRECOMP", sourceText: null, sourceCompositionId: "comp-4242", stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        { layerIndex: 3, layerName: "Footage Layer", layerType: "AV", sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        { layerIndex: 4, layerName: "Shape Layer", layerType: "OTHER", sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        // layerIndex 5 (__unreadableLayer) is honestly omitted, never guessed.
        { layerIndex: 6, layerName: "Static Zero Opacity Layer", layerType: "AV", sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: 0, opacityKeyframes: null },
        {
          layerIndex: 7,
          layerName: "Fading Layer",
          layerType: "AV",
          sourceText: null,
          sourceCompositionId: null,
          stretchPercent: null,
          timeRemapEnabled: null,
          opacityStatic: null,
          opacityKeyframes: [
            { timeSeconds: 1, valuePercent: 0 },
            { timeSeconds: 2.5, valuePercent: 100 },
            { timeSeconds: 4, valuePercent: 0 }
          ]
        }
      ]
    });
  });

  it("reads a static (non-animated) opacity value via numKeys === 0, real live-QA 2026-09-10 incident shape (a confirmed-zero opacity, distinct from a keyframed fade)", () => {
    const script = buildInspectCompositionLayerDetailsScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, FAKE_LAYER_DETAILS_APP_SETUP);
    const result = JSON.parse(resultText) as { layerDetails: { layerIndex: number; opacityStatic: number | null; opacityKeyframes: unknown }[] };
    const staticLayer = result.layerDetails.find((d) => d.layerIndex === 6)!;
    expect(staticLayer.opacityStatic).toBe(0);
    expect(staticLayer.opacityKeyframes).toBeNull();
  });

  it("reads the REAL ordered keyframe list (time + value) via numKeys > 0, never merely a single sampled value, when opacity is animated", () => {
    const script = buildInspectCompositionLayerDetailsScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, FAKE_LAYER_DETAILS_APP_SETUP);
    const result = JSON.parse(resultText) as { layerDetails: { layerIndex: number; opacityStatic: number | null; opacityKeyframes: { timeSeconds: number; valuePercent: number }[] | null }[] };
    const fadingLayer = result.layerDetails.find((d) => d.layerIndex === 7)!;
    expect(fadingLayer.opacityStatic).toBeNull();
    expect(fadingLayer.opacityKeyframes).toEqual([
      { timeSeconds: 1, valuePercent: 0 },
      { timeSeconds: 2.5, valuePercent: 100 },
      { timeSeconds: 4, valuePercent: 0 }
    ]);
  });

  it("verifies the real Hebrew sourceText round-trips through the shim by exact codepoint, not merely visual/string equality - regression guard against RTL-rendering mishaps", () => {
    const script = buildInspectCompositionLayerDetailsScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, FAKE_LAYER_DETAILS_APP_SETUP);
    const result = JSON.parse(resultText) as { layerDetails: { sourceText: string | null }[] };
    const hebrewPrefix = result.layerDetails[0]!.sourceText!.split(" ")[0]!;
    expect([...hebrewPrefix].map((c) => c.codePointAt(0))).toEqual([0x05de, 0x05d1, 0x05d9, 0x05ea]);
  });

  it("real 2026-09-10 incident (session a7fee3d9): \"discovery\" mode still classifies layerType/sourceCompositionId correctly, but skips the stretch/timeRemapEnabled/opacity/sourceText reads entirely - null for all four, on every layer, real or fake", () => {
    const script = buildInspectCompositionLayerDetailsScript(1, COMP_NAME, "discovery");
    const resultText = runFixedScriptWithoutNativeJson(script, FAKE_LAYER_DETAILS_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result).toEqual({
      ok: true,
      layerDetails: [
        { layerIndex: 1, layerName: "Hebrew Branding", layerType: "TEXT", sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        { layerIndex: 2, layerName: "Nested Comp Ref", layerType: "PRECOMP", sourceText: null, sourceCompositionId: "comp-4242", stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        { layerIndex: 3, layerName: "Footage Layer", layerType: "AV", sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        { layerIndex: 4, layerName: "Shape Layer", layerType: "OTHER", sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        { layerIndex: 6, layerName: "Static Zero Opacity Layer", layerType: "AV", sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null },
        { layerIndex: 7, layerName: "Fading Layer", layerType: "AV", sourceText: null, sourceCompositionId: null, stretchPercent: null, timeRemapEnabled: null, opacityStatic: null, opacityKeyframes: null }
      ]
    });
  });

  it("\"discovery\" mode NEVER even ATTEMPTS to read .stretch/.timeRemapEnabled/.opacity/.sourceText.value - proven by a call counter on each getter, which \"full\" mode DOES increment", () => {
    const countingSetup = `
      function CompItem() {}
      function AVLayer() {}
      function TextLayer() {}
      TextLayer.prototype = new AVLayer();
      var __reads = { stretch: 0, timeRemapEnabled: 0, opacity: 0, sourceText: 0 };
      var __fakeComp = new CompItem();
      __fakeComp.name = ${JSON.stringify(COMP_NAME)};
      __fakeComp.numLayers = 1;
      var __countingLayer = new TextLayer();
      __countingLayer.index = 1;
      __countingLayer.name = "Counts Reads";
      Object.defineProperty(__countingLayer, "stretch", { get: function () { __reads.stretch++; return 100; } });
      Object.defineProperty(__countingLayer, "timeRemapEnabled", { get: function () { __reads.timeRemapEnabled++; return false; } });
      Object.defineProperty(__countingLayer, "opacity", { get: function () { __reads.opacity++; return { numKeys: 0, value: 100 }; } });
      Object.defineProperty(__countingLayer, "sourceText", { get: function () { __reads.sourceText++; return { value: { text: "x" } }; } });
      __fakeComp.layer = function (i) { return i === 1 ? __countingLayer : undefined; };
      var app = {
        beginUndoGroup: function () {},
        endUndoGroup: function () {},
        project: { item: function (i) { return i === 1 ? __fakeComp : null; } }
      };
    `;
    function runAndReturnContext(script: string): { __reads: Record<string, number> } {
      const context = vm.createContext({});
      vm.runInContext("JSON = undefined;", context);
      vm.runInContext(countingSetup, context);
      vm.runInContext(`(new Function("args", ${JSON.stringify(script)}))()`, context);
      return context as unknown as { __reads: Record<string, number> };
    }

    const discoveryScript = buildInspectCompositionLayerDetailsScript(1, COMP_NAME, "discovery");
    expect(runAndReturnContext(discoveryScript).__reads).toEqual({ stretch: 0, timeRemapEnabled: 0, opacity: 0, sourceText: 0 });

    const fullScript = buildInspectCompositionLayerDetailsScript(1, COMP_NAME);
    expect(runAndReturnContext(fullScript).__reads).toEqual({ stretch: 1, timeRemapEnabled: 1, opacity: 1, sourceText: 1 });
  });

  it("\"discovery\" mode is deterministic and byte-differs from the default \"full\" mode script for the same composition", () => {
    const discovery1 = buildInspectCompositionLayerDetailsScript(3, COMP_NAME, "discovery");
    const discovery2 = buildInspectCompositionLayerDetailsScript(3, COMP_NAME, "discovery");
    const full = buildInspectCompositionLayerDetailsScript(3, COMP_NAME);
    expect(discovery1).toBe(discovery2);
    expect(discovery1).not.toBe(full);
  });

  it("fails closed with a typed failureReason when the project item index does not resolve to the expected composition name", () => {
    const script = buildInspectCompositionLayerDetailsScript(1, "Wrong Expected Name");
    const resultText = runFixedScriptWithoutNativeJson(script, FAKE_LAYER_DETAILS_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("Wrong Expected Name");
  });

  it("is deterministic - the same composition index/name always produces byte-identical JSX", () => {
    expect(buildInspectCompositionLayerDetailsScript(3, COMP_NAME)).toBe(buildInspectCompositionLayerDetailsScript(3, COMP_NAME));
  });

  it("never mutates the project - contains no .setSource/.remove()/.sourceText.setValue call", () => {
    const script = buildInspectCompositionLayerDetailsScript(1, COMP_NAME);
    expect(script).not.toMatch(/\.setSource\s*\(/);
    expect(script).not.toMatch(/\.remove\s*\(\s*\)/);
    expect(script).not.toMatch(/\.setValue\s*\(/);
  });
});

describe("buildFindHostLayersScript (live QA, 2026-09-10 real incident: targeted host-layer lookup, session a7fee3d9)", () => {
  /**
   * Fake composition exercising: a non-matching precomp (different real
   * source id), a real MATCH, a plain footage layer (no source at all), a
   * SECOND real match (multi-instance), and a layer whose own `.source`
   * read throws. Every layer's expensive properties (stretch/
   * timeRemapEnabled/opacity) are call-counted so tests can prove they
   * were read ONLY for the two real matches, never for the others - not
   * merely that the final result happens to omit them.
   */
  const FIND_HOST_LAYERS_APP_SETUP = `
    function CompItem() {}
    function AVLayer() {}

    var __reads = { stretch: 0, timeRemapEnabled: 0, opacity: 0 };

    var __targetSource = new CompItem();
    __targetSource.id = 1635;
    var __otherSource = new CompItem();
    __otherSource.id = 999;

    function makePrecompLayer(index, name, source) {
      var l = new AVLayer();
      l.index = index;
      l.name = name;
      l.source = source;
      l.enabled = true;
      l.inPoint = index * 1.5;
      l.outPoint = index * 1.5 + 5;
      l.startTime = index * 0.5;
      Object.defineProperty(l, "stretch", { get: function () { __reads.stretch++; return 100; } });
      Object.defineProperty(l, "timeRemapEnabled", { get: function () { __reads.timeRemapEnabled++; return false; } });
      Object.defineProperty(l, "opacity", { get: function () { __reads.opacity++; return { numKeys: 0, value: 100 }; } });
      return l;
    }

    var __otherPrecompLayer = makePrecompLayer(1, "Other Precomp", __otherSource);
    var __matchLayerA = makePrecompLayer(2, "Target Precomp A", __targetSource);
    var __footageLayer = new AVLayer();
    __footageLayer.index = 3;
    __footageLayer.name = "Footage";
    var __matchLayerB = makePrecompLayer(4, "Target Precomp B", __targetSource);
    var __throwingSourceLayer = {};
    __throwingSourceLayer.index = 5;
    __throwingSourceLayer.name = "Throws On Source Read";
    Object.defineProperty(__throwingSourceLayer, "source", { get: function () { throw new Error("boom"); } });

    var __fakeComp = new CompItem();
    __fakeComp.name = ${JSON.stringify(COMP_NAME)};
    __fakeComp.numLayers = 5;
    var __layersByIndex = { 1: __otherPrecompLayer, 2: __matchLayerA, 3: __footageLayer, 4: __matchLayerB, 5: __throwingSourceLayer };
    __fakeComp.layer = function (i) { return __layersByIndex[i]; };

    var app = {
      beginUndoGroup: function () {},
      endUndoGroup: function () {},
      project: { item: function (i) { return i === 1 ? __fakeComp : null; } }
    };
  `;

  it("finds every real matching host layer, and returns NOTHING at all for non-matching layers (not even a stub record)", () => {
    const script = buildFindHostLayersScript(1, COMP_NAME, "comp-1635");
    const resultText = runFixedScriptWithoutNativeJson(script, FIND_HOST_LAYERS_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      {
        layerIndex: 2,
        layerName: "Target Precomp A",
        enabled: true,
        inPointSeconds: 3,
        outPointSeconds: 8,
        startTimeSeconds: 1,
        sourceCompositionId: "comp-1635",
        stretchPercent: 100,
        timeRemapEnabled: false,
        opacityStatic: 100,
        opacityKeyframes: null
      },
      {
        layerIndex: 4,
        layerName: "Target Precomp B",
        enabled: true,
        inPointSeconds: 6,
        outPointSeconds: 11,
        startTimeSeconds: 2,
        sourceCompositionId: "comp-1635",
        stretchPercent: 100,
        timeRemapEnabled: false,
        opacityStatic: 100,
        opacityKeyframes: null
      }
    ]);
  });

  it("the real performance fix: reads stretch/timeRemapEnabled/opacity ONLY for the real matches (2 layers), never for the 3 non-matching layers - proven by a real call counter on each getter, not merely the result shape", () => {
    const script = buildFindHostLayersScript(1, COMP_NAME, "comp-1635");
    const context = vm.createContext({});
    vm.runInContext("JSON = undefined;", context);
    vm.runInContext(FIND_HOST_LAYERS_APP_SETUP, context);
    vm.runInContext(`(new Function("args", ${JSON.stringify(script)}))()`, context);
    const reads = (context as unknown as { __reads: Record<string, number> }).__reads;
    // Exactly 2 matches -> exactly 2 reads of each expensive property, never 5 (the total layer count).
    expect(reads).toEqual({ stretch: 2, timeRemapEnabled: 2, opacity: 2 });
  });

  it("real 2026-09-10 incident: multiple instances of the same child composition inside one parent are ALL reported, never silently narrowed to the first match", () => {
    const script = buildFindHostLayersScript(1, COMP_NAME, "comp-1635");
    const resultText = runFixedScriptWithoutNativeJson(script, FIND_HOST_LAYERS_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.matches.map((m: { layerIndex: number }) => m.layerIndex)).toEqual([2, 4]);
  });

  it("returns a genuine, successful EMPTY matches array (never a failure) when no real layer hosts the target composition - MANIFEST_EDGE_NOT_FOUND_IN_AE is a caller-side conclusion from this, not something this script itself reports", () => {
    const script = buildFindHostLayersScript(1, COMP_NAME, "comp-does-not-exist");
    const resultText = runFixedScriptWithoutNativeJson(script, FIND_HOST_LAYERS_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result).toEqual({ ok: true, matches: [] });
  });

  it("skips (rather than fails the whole scan for) a layer whose own .source read throws", () => {
    const script = buildFindHostLayersScript(1, COMP_NAME, "comp-1635");
    const resultText = runFixedScriptWithoutNativeJson(script, FIND_HOST_LAYERS_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    expect(result.matches.map((m: { layerIndex: number }) => m.layerIndex)).not.toContain(5);
  });

  it("fails closed with a typed failureReason when the project item index does not resolve to the expected composition name", () => {
    const script = buildFindHostLayersScript(1, "Wrong Expected Name", "comp-1635");
    const resultText = runFixedScriptWithoutNativeJson(script, FIND_HOST_LAYERS_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("Wrong Expected Name");
  });

  it("is deterministic - the same composition index/name/target always produces byte-identical JSX, and a different target produces different JSX", () => {
    const a = buildFindHostLayersScript(3, COMP_NAME, "comp-1635");
    const b = buildFindHostLayersScript(3, COMP_NAME, "comp-1635");
    const c = buildFindHostLayersScript(3, COMP_NAME, "comp-9999");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("never mutates the project - contains no .setSource/.remove()/.sourceText.setValue call", () => {
    const script = buildFindHostLayersScript(1, COMP_NAME, "comp-1635");
    expect(script).not.toMatch(/\.setSource\s*\(/);
    expect(script).not.toMatch(/\.remove\s*\(\s*\)/);
    expect(script).not.toMatch(/\.setValue\s*\(/);
  });

  it("never contains a `break` - scans every layer to completion by design (multi-instance requirement), unlike the early-exit discovery mode this replaces", () => {
    const script = buildFindHostLayersScript(1, COMP_NAME, "comp-1635");
    expect(script).not.toMatch(/break;/);
  });
});

describe("buildDescribeCompositionSummaryScript (real 2026-09-10 incident, session a7fee3d9: Landscape master renders with visible content ending early)", () => {
  const DESCRIBE_SUMMARY_APP_SETUP = `
    function CompItem() {}
    function AVLayer() {}

    var __reads = { sourceRectAtTime: 0, stretch: 0, opacity: 0 };

    var __nestedSource = new CompItem();
    __nestedSource.id = 1;
    __nestedSource.duration = 7.007007007007;

    function makeLayer(index, name, opts) {
      opts = opts || {};
      var l = new AVLayer();
      l.index = index;
      l.name = name;
      l.enabled = opts.enabled !== undefined ? opts.enabled : true;
      l.inPoint = opts.inPoint !== undefined ? opts.inPoint : 0;
      l.outPoint = opts.outPoint !== undefined ? opts.outPoint : 5;
      l.startTime = opts.startTime !== undefined ? opts.startTime : 0;
      if (opts.source) { l.source = opts.source; }
      Object.defineProperty(l, "stretch", { get: function () { __reads.stretch++; return 100; } });
      Object.defineProperty(l, "opacity", { get: function () { __reads.opacity++; return { numKeys: 0, value: 100 }; } });
      var __origSourceRectAtTime = l.sourceRectAtTime;
      l.sourceRectAtTime = function () { __reads.sourceRectAtTime++; return { left: 0, top: 0, width: 10, height: 10 }; };
      return l;
    }

    var __layer1 = makeLayer(1, "Scene 1", { inPoint: 1.635, outPoint: 8.642, startTime: 1.635, source: __nestedSource });
    var __layer2 = makeLayer(2, "Photo", { enabled: false });

    var __fakeComp = new CompItem();
    __fakeComp.name = ${JSON.stringify(COMP_NAME)};
    __fakeComp.numLayers = 2;
    __fakeComp.duration = 45.045045045045;
    __fakeComp.workAreaStart = 0;
    __fakeComp.workAreaDuration = 31.7317;
    __fakeComp.frameRate = 29.9700012207031;
    var __layersByIndex = { 1: __layer1, 2: __layer2 };
    __fakeComp.layer = function (i) { return __layersByIndex[i]; };

    var app = {
      beginUndoGroup: function () {},
      endUndoGroup: function () {},
      project: { item: function (i) { return i === 1 ? __fakeComp : null; } }
    };
  `;

  it("reports the real comp-level duration/work-area/frameRate facts, never fabricated", () => {
    const script = buildDescribeCompositionSummaryScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, DESCRIBE_SUMMARY_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    expect(result.compDurationSeconds).toBe(45.045045045045);
    expect(result.workAreaStartSeconds).toBe(0);
    expect(result.workAreaDurationSeconds).toBe(31.7317);
    expect(result.frameRate).toBe(29.9700012207031);
  });

  it("reports every top-level layer's cheap facts, including a DISABLED layer - never silently skipped", () => {
    const script = buildDescribeCompositionSummaryScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, DESCRIBE_SUMMARY_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.layers).toEqual([
      { layerIndex: 1, layerName: "Scene 1", enabled: true, inPointSeconds: 1.635, outPointSeconds: 8.642, startTimeSeconds: 1.635, sourceCompositionId: "comp-1", sourceDurationSeconds: 7.007007007007 },
      { layerIndex: 2, layerName: "Photo", enabled: false, inPointSeconds: 0, outPointSeconds: 5, startTimeSeconds: 0, sourceCompositionId: null, sourceDurationSeconds: null }
    ]);
  });

  it("the real performance fix: never reads stretch/opacity for ANY layer - only the cheap properties every layer object already carries", () => {
    const script = buildDescribeCompositionSummaryScript(1, COMP_NAME);
    const context = vm.createContext({});
    vm.runInContext("JSON = undefined;", context);
    vm.runInContext(DESCRIBE_SUMMARY_APP_SETUP, context);
    vm.runInContext(`(new Function("args", ${JSON.stringify(script)}))()`, context);
    const reads = vm.runInContext("__reads", context) as { sourceRectAtTime: number; stretch: number; opacity: number };
    expect(reads.stretch).toBe(0);
    expect(reads.opacity).toBe(0);
    expect(reads.sourceRectAtTime).toBe(0);
  });

  it("resolves and name-verifies the composition before touching anything, the same as every other script", () => {
    const script = buildDescribeCompositionSummaryScript(1, "Wrong Expected Name");
    const resultText = runFixedScriptWithoutNativeJson(script, DESCRIBE_SUMMARY_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("refusing to report facts about the wrong composition");
  });

  it("is deterministic - the same composition index/name always produces byte-identical JSX", () => {
    const a = buildDescribeCompositionSummaryScript(3, COMP_NAME);
    const b = buildDescribeCompositionSummaryScript(3, COMP_NAME);
    expect(a).toBe(b);
  });

  it("never mutates the project - contains no .setSource/.remove()/.sourceText.setValue/.setValue call", () => {
    const script = buildDescribeCompositionSummaryScript(1, COMP_NAME);
    expect(script).not.toMatch(/\.setSource\s*\(/);
    expect(script).not.toMatch(/\.remove\s*\(\s*\)/);
    expect(script).not.toMatch(/\.setValue\s*\(/);
  });

  it("never contains a `break` - scans every layer to completion, same convention as buildFindHostLayersScript", () => {
    const script = buildDescribeCompositionSummaryScript(1, COMP_NAME);
    expect(script).not.toMatch(/break;/);
  });
});

describe("buildInspectLayerTransformScript (real 2026-09-11 nested-content audit, session a7fee3d9: comp-1600's own Camera 1/Element 3D layers)", () => {
  const TRANSFORM_APP_SETUP = `
    function CompItem() {}
    function AVLayer() {}
    function CameraLayer() {}

    function makeAnimatableProp(staticValue, keyframes) {
      var __keys = keyframes || [];
      return {
        numKeys: __keys.length,
        value: staticValue,
        keyTime: function (i) { return __keys[i - 1].time; },
        keyValue: function (i) { return __keys[i - 1].value; }
      };
    }

    function makeEffectsGroup(effects) {
      return {
        numProperties: effects.length,
        property: function (i) {
          var e = effects[i - 1];
          return { name: e.name, matchName: e.matchName, enabled: e.enabled };
        }
      };
    }

    var __camera = new CameraLayer();
    __camera.index = 2;
    __camera.name = "Camera 1";
    __camera.enabled = true;
    __camera.threeDLayer = true;
    __camera.transform = {
      position: makeAnimatableProp([960, 540, -1000], [
        { time: 0, value: [960, 540, -1000] },
        { time: 2.612, value: [960, 540, -300] }
      ]),
      anchorPoint: makeAnimatableProp([0, 0, 0], [])
    };
    __camera.pointOfInterest = makeAnimatableProp([960, 540, 0], []);
    __camera.zoom = makeAnimatableProp(2779, [
      { time: 0, value: 2779 },
      { time: 2.612, value: 800 }
    ]);

    var __elementLayer = new AVLayer();
    __elementLayer.index = 5;
    __elementLayer.name = "Element 3D";
    __elementLayer.enabled = true;
    __elementLayer.threeDLayer = false;
    __elementLayer.transform = {
      position: makeAnimatableProp([960, 540], []),
      scale: makeAnimatableProp([100, 100], []),
      rotation: makeAnimatableProp(0, []),
      anchorPoint: makeAnimatableProp([0, 0], [])
    };
    __elementLayer.property = function (name) {
      if (name === "ADBE Effect Parade") {
        return makeEffectsGroup([{ name: "Element", matchName: "Video Copilot.Element", enabled: true }]);
      }
      return null;
    };

    var __brokenLayer = new AVLayer();
    __brokenLayer.index = 6;
    __brokenLayer.name = "Broken Layer";
    Object.defineProperty(__brokenLayer, "transform", { get: function () { throw new Error("simulated unreadable layer"); } });

    var __fakeComp = new CompItem();
    __fakeComp.name = ${JSON.stringify(COMP_NAME)};
    __fakeComp.numLayers = 3;
    var __layersByIndex = { 1: __camera, 2: __elementLayer, 3: __brokenLayer };
    __fakeComp.layer = function (i) { return __layersByIndex[i]; };

    var app = {
      beginUndoGroup: function () {},
      endUndoGroup: function () {},
      project: { item: function (i) { return i === 1 ? __fakeComp : null; } }
    };
  `;

  it("reports a camera's own animated position and zoom keyframes, with scale/rotation left null (cameras have no such properties)", () => {
    const script = buildInspectLayerTransformScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, TRANSFORM_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    const camera = result.layers.find((l: { layerName: string }) => l.layerName === "Camera 1");
    expect(camera.isCameraLayer).toBe(true);
    expect(camera.scale).toBeNull();
    expect(camera.rotation).toBeNull();
    expect(camera.position.animated).toBe(true);
    expect(camera.position.keyframes).toEqual([
      { timeSeconds: 0, value: [960, 540, -1000] },
      { timeSeconds: 2.612, value: [960, 540, -300] }
    ]);
    expect(camera.zoom.animated).toBe(true);
    expect(camera.zoom.keyframes).toEqual([
      { timeSeconds: 0, value: 2779 },
      { timeSeconds: 2.612, value: 800 }
    ]);
  });

  it("reports a non-camera layer's static (non-animated) transform properties and its real applied effects, with pointOfInterest/zoom left null", () => {
    const script = buildInspectLayerTransformScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, TRANSFORM_APP_SETUP);
    const result = JSON.parse(resultText);
    const element = result.layers.find((l: { layerName: string }) => l.layerName === "Element 3D");
    expect(element.isCameraLayer).toBe(false);
    expect(element.pointOfInterest).toBeNull();
    expect(element.zoom).toBeNull();
    expect(element.position).toEqual({ animated: false, currentValue: [960, 540], keyframes: null });
    expect(element.scale).toEqual({ animated: false, currentValue: [100, 100], keyframes: null });
    expect(element.effects).toEqual([{ name: "Element", matchName: "Video Copilot.Element", enabled: true }]);
  });

  it("skips (rather than fails the whole scan for) a layer whose transform cannot be read - best-effort, never crashes", () => {
    const script = buildInspectLayerTransformScript(1, COMP_NAME);
    const resultText = runFixedScriptWithoutNativeJson(script, TRANSFORM_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    expect(result.layers.map((l: { layerName: string }) => l.layerName)).toEqual(["Camera 1", "Element 3D"]);
  });

  it("resolves and name-verifies the composition before touching anything, the same as every other script", () => {
    const script = buildInspectLayerTransformScript(1, "Wrong Expected Name");
    const resultText = runFixedScriptWithoutNativeJson(script, TRANSFORM_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("refusing to report facts about the wrong composition");
  });

  it("is deterministic - the same composition index/name always produces byte-identical JSX", () => {
    const a = buildInspectLayerTransformScript(3, COMP_NAME);
    const b = buildInspectLayerTransformScript(3, COMP_NAME);
    expect(a).toBe(b);
  });

  it("never mutates the project - contains no .setSource/.remove()/.setValue call", () => {
    const script = buildInspectLayerTransformScript(1, COMP_NAME);
    expect(script).not.toMatch(/\.setSource\s*\(/);
    expect(script).not.toMatch(/\.remove\s*\(\s*\)/);
    expect(script).not.toMatch(/\.setValue\s*\(/);
  });

  it("never contains a `break` - scans every layer to completion, same convention as buildDescribeCompositionSummaryScript", () => {
    const script = buildInspectLayerTransformScript(1, COMP_NAME);
    expect(script).not.toMatch(/break;/);
  });
});

describe("buildScanProjectPreflightScript (real 2026-09-11 incident: 51-composition candidate too large to check one composition at a time)", () => {
  const PROJECT_SCAN_SETUP = `
    function CompItem() {}
    function AVLayer() {}
    function TextLayer() {}
    function ShapeLayer() {}
    function CameraLayer() {}
    function LightLayer() {}
    function FootageItem() {}
    function SolidSource() {}

    function makeEffectsGroup(effects) {
      return {
        numProperties: effects.length,
        property: function (i) {
          var e = effects[i - 1];
          return { name: e.name, matchName: e.matchName, enabled: e.enabled };
        }
      };
    }

    function makeLayer(index, name, effects) {
      var layer = new AVLayer();
      layer.index = index; layer.name = name; layer.enabled = true;
      if (effects) {
        layer.property = function (propName) {
          if (propName === "ADBE Effect Parade") {
            return makeEffectsGroup(effects);
          }
          return null;
        };
      }
      return layer;
    }

    // Comp A: one layer with a real third-party effect (mirrors the real
    // Element 3D incident's own matchName), one layer with a native effect,
    // one with no effects group at all.
    var __compA = new CompItem();
    __compA.id = 210;
    __compA.name = "!Render";
    __compA.numLayers = 4;
    var __compALayers = {
      1: makeLayer(1, "Element 3D", [{ name: "Element", matchName: "VIDEOCOPILOT 3DArray", enabled: true }]),
      2: makeLayer(2, "Blur Layer", [{ name: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", enabled: true }]),
      3: makeLayer(3, "Plain Layer", null),
      4: (function () {
        var textLayer = new TextLayer();
        textLayer.index = 4; textLayer.name = "Headline"; textLayer.enabled = true;
        textLayer.sourceText = { value: { font: "Evolventa-Bold" } };
        return textLayer;
      })()
    };
    __compA.layer = function (i) { return __compALayers[i]; };

    // Comp B: nested, no effects anywhere - should not appear in the result at all.
    var __compB = new CompItem();
    __compB.id = 99;
    __compB.name = "Pre-comp 3";
    __compB.numLayers = 1;
    var __compBLayers = { 1: makeLayer(1, "Solid", null) };
    __compB.layer = function (i) { return __compBLayers[i]; };

    // Real footage items - captured separately from compositions, with AE's own footageMissing flag.
    function FootageItem() {}
    var __footage = new FootageItem();
    __footage.name = "some-image.png";
    __footage.file = { fsName: "C:\\\\assets\\\\some-image.png" };
    __footage.footageMissing = false;

    var __missingFootage = new FootageItem();
    __missingFootage.name = "gone.mp4";
    __missingFootage.file = { fsName: "C:\\\\assets\\\\gone.mp4" };
    __missingFootage.footageMissing = true;

    // A layer whose own effects read throws - must not fail the whole scan.
    var __compC = new CompItem();
    __compC.id = 7;
    __compC.name = "Broken Comp";
    __compC.numLayers = 1;
    var __brokenLayer = { index: 1, name: "Broken Layer" };
    Object.defineProperty(__brokenLayer, "property", { get: function () { throw new Error("simulated unreadable effects group"); } });
    __compC.layer = function () { return __brokenLayer; };

    var __itemsByIndex = { 1: __compA, 2: __compB, 3: __footage, 4: __compC, 5: __missingFootage };
    var app = {
      beginUndoGroup: function () {},
      endUndoGroup: function () {},
      project: {
        numItems: 5,
        item: function (i) { return __itemsByIndex[i]; }
      }
    };
  `;

  it("scans every composition in the project (not just one), reporting every layer so real placeholders can be classified", () => {
    const script = buildScanProjectPreflightScript();
    const resultText = runFixedScriptWithoutNativeJson(script, PROJECT_SCAN_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    expect(result.compositionCount).toBe(5);
    // Every composition is reported now, not only those carrying effects -
    // layer type/footage facts are what placeholder classification needs.
    expect(result.compositions.map((c: { compositionName: string }) => c.compositionName)).toEqual(["!Render", "Pre-comp 3", "Broken Comp"]);
  });

  it("reports each effect's real name/matchName/enabled - proving an effect was applied, e.g. the real Element 3D matchName from the unrelated 2026-09-11 incident", () => {
    const script = buildScanProjectPreflightScript();
    const resultText = runFixedScriptWithoutNativeJson(script, PROJECT_SCAN_SETUP);
    const result = JSON.parse(resultText);
    const render = result.compositions.find((c: { compositionName: string }) => c.compositionName === "!Render");
    expect(render.compositionId).toBe(210);
    const elementLayer = render.layers.find((l: { layerName: string }) => l.layerName === "Element 3D");
    expect(elementLayer.effects).toEqual([{ name: "Element", matchName: "VIDEOCOPILOT 3DArray", enabled: true }]);
    const blurLayer = render.layers.find((l: { layerName: string }) => l.layerName === "Blur Layer");
    expect(blurLayer.effects).toEqual([{ name: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", enabled: true }]);
    // Every layer is reported, including those with no effects at all.
    expect(render.layers.map((l: { layerName: string }) => l.layerName)).toEqual(["Element 3D", "Blur Layer", "Plain Layer", "Headline"]);
  });

  it("skips non-composition project items (e.g. footage) without treating them as compositions", () => {
    const script = buildScanProjectPreflightScript();
    const resultText = runFixedScriptWithoutNativeJson(script, PROJECT_SCAN_SETUP);
    const result = JSON.parse(resultText);
    expect(result.compositions.some((c: { compositionName: string }) => c.compositionName === "some-image.png")).toBe(false);
  });

  it("skips a layer whose effects cannot be read, rather than failing the whole scan", () => {
    const script = buildScanProjectPreflightScript();
    const resultText = runFixedScriptWithoutNativeJson(script, PROJECT_SCAN_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    const broken = result.compositions.find((c: { compositionName: string }) => c.compositionName === "Broken Comp");
    // The layer is still reported (name/type are readable) - only its
    // unreadable effects list comes back empty, never the whole scan failing.
    expect(broken.layers).toHaveLength(1);
    expect(broken.layers[0].layerName).toBe("Broken Layer");
    expect(broken.layers[0].effects).toEqual([]);
  });

  it("reports each layer's real AE type and footage facts - what placeholder classification needs, and what was permanently 'Unknown' before", () => {
    const script = buildScanProjectPreflightScript();
    const resultText = runFixedScriptWithoutNativeJson(script, PROJECT_SCAN_SETUP);
    const result = JSON.parse(resultText);
    const render = result.compositions.find((c: { compositionName: string }) => c.compositionName === "!Render");
    const headline = render.layers.find((l: { layerName: string }) => l.layerName === "Headline");
    expect(headline.kind).toBe("TextLayer");
  });

  it("collects every text layer's own font in the same single pass - the fact that was invisible while the real 2026-09-11 candidate had unresolvable Evolventa fonts", () => {
    const script = buildScanProjectPreflightScript();
    const resultText = runFixedScriptWithoutNativeJson(script, PROJECT_SCAN_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    expect(result.fonts).toEqual(["Evolventa-Bold"]);
  });

  it("captures every FootageItem with AE's own footageMissing flag, and never treats one as a composition", () => {
    const script = buildScanProjectPreflightScript();
    const resultText = runFixedScriptWithoutNativeJson(script, PROJECT_SCAN_SETUP);
    const result = JSON.parse(resultText);
    expect(result.footage).toEqual([
      { name: "some-image.png", path: "C:\\assets\\some-image.png", missing: false },
      { name: "gone.mp4", path: "C:\\assets\\gone.mp4", missing: true }
    ]);
    expect(result.compositions.some((c: { compositionName: string }) => c.compositionName === "gone.mp4")).toBe(false);
  });

  it("is deterministic - takes no arguments, always produces byte-identical JSX", () => {
    expect(buildScanProjectPreflightScript()).toBe(buildScanProjectPreflightScript());
  });

  it("never mutates the project - contains no .setSource/.remove()/.setValue call", () => {
    const script = buildScanProjectPreflightScript();
    expect(script).not.toMatch(/\.setSource\s*\(/);
    expect(script).not.toMatch(/\.remove\s*\(\s*\)/);
    expect(script).not.toMatch(/\.setValue\s*\(/);
  });

  it("never uses `break` - scans every project item and every layer to completion", () => {
    const script = buildScanProjectPreflightScript();
    expect(script).not.toMatch(/break;/);
  });

  it("reports every layer-role fact as null (never false, never a failed scan) when this AE build or layer type does not expose it", () => {
    const script = buildScanProjectPreflightScript();
    const result = JSON.parse(runFixedScriptWithoutNativeJson(script, PROJECT_SCAN_SETUP));
    expect(result.ok).toBe(true);
    const render = result.compositions.find((c: { compositionName: string }) => c.compositionName === "!Render");
    const plain = render.layers.find((l: { layerName: string }) => l.layerName === "Plain Layer");
    // No TrackMatteType/BlendingMode globals and no layer properties in this
    // fixture - every fact is unreadable, so every fact is null.
    expect(Object.values(plain.detail).every((value) => value === null)).toBe(true);
    expect(Object.keys(plain.detail)).toHaveLength(19);
    const broken = result.compositions.find((c: { compositionName: string }) => c.compositionName === "Broken Comp");
    expect(broken.layers[0].detail.opacityAtInPoint).toBeNull();
  });

  describe("layer-role evidence (2026-09-13 Mixkit classification questions: mattes, pre-rendered passes, guide texts)", () => {
    const LAYER_ROLE_SETUP = `
      function CompItem() {}
      function AVLayer() {}
      function TextLayer() {}
      function ShapeLayer() {}
      function CameraLayer() {}
      function LightLayer() {}
      function FootageItem() {}
      function SolidSource() {}
      // Non-enumerable, like a native AE enum may be - labels must still resolve.
      var TrackMatteType = {};
      Object.defineProperty(TrackMatteType, "ALPHA", { value: 5012, enumerable: false });
      Object.defineProperty(TrackMatteType, "ALPHA_INVERTED", { value: 5013, enumerable: false });
      Object.defineProperty(TrackMatteType, "LUMA", { value: 5014, enumerable: false });
      Object.defineProperty(TrackMatteType, "LUMA_INVERTED", { value: 5015, enumerable: false });
      Object.defineProperty(TrackMatteType, "NO_TRACK_MATTE", { value: 5016, enumerable: false });
      var BlendingMode = { NORMAL: 5212, STENCIL_ALPHA: 5220 };

      function withTransform(layer, opacity, numKeys) {
        layer.property = function (name) {
          if (name === "ADBE Transform Group") {
            return { property: function (inner) { return inner === "ADBE Opacity" ? { numKeys: numKeys, valueAtTime: function () { return opacity; } } : null; } };
          }
          return null;
        };
        return layer;
      }

      var __screenComp = new CompItem();
      __screenComp.id = 50; __screenComp.name = "_Place Image Above_1"; __screenComp.numLayers = 0;
      __screenComp.layer = function () { return null; };

      var __maskFootage = new FootageItem();
      __maskFootage.name = "Smartphone_01_Placeholder_Mask_1.mov"; __maskFootage.hasVideo = true; __maskFootage.mainSource = {};

      var __mask = withTransform(new AVLayer(), 100, 0);
      __mask.index = 1; __mask.name = "Mask"; __mask.enabled = false; __mask.source = __maskFootage;
      __mask.isTrackMatte = true; __mask.hasTrackMatte = false; __mask.trackMatteType = TrackMatteType.NO_TRACK_MATTE; __mask.trackMatteLayer = null;
      __mask.guideLayer = false; __mask.adjustmentLayer = false; __mask.nullLayer = false; __mask.shy = false; __mask.threeDLayer = false;
      __mask.blendingMode = BlendingMode.NORMAL; __mask.preserveTransparency = false; __mask.parent = null; __mask.inPoint = 0; __mask.outPoint = 4.5;

      var __screen = withTransform(new AVLayer(), 100, 2);
      __screen.index = 2; __screen.name = "_Place Image Above_1"; __screen.enabled = true; __screen.source = __screenComp;
      __screen.isTrackMatte = false; __screen.hasTrackMatte = true; __screen.trackMatteType = TrackMatteType.LUMA; __screen.trackMatteLayer = __mask;
      __screen.blendingMode = BlendingMode.NORMAL; __screen.parent = __mask; __screen.inPoint = 0.5; __screen.outPoint = 4.5;

      var __guide = withTransform(new TextLayer(), 0, 0);
      __guide.index = 3; __guide.name = "PLACE YOUR IMAGE HERE"; __guide.enabled = true; __guide.guideLayer = true;
      __guide.sourceText = { value: { font: "Montserrat-Bold", text: "PLACE YOUR IMAGE HERE " + new Array(201).join("x") } };

      var __unreadableMatte = withTransform(new AVLayer(), 100, 0);
      __unreadableMatte.index = 4; __unreadableMatte.name = "Unreadable matte"; __unreadableMatte.enabled = true; __unreadableMatte.hasTrackMatte = true;
      Object.defineProperty(__unreadableMatte, "trackMatteLayer", { get: function () { throw new Error("simulated older AE build"); } });

      var __phoneComp = new CompItem();
      __phoneComp.id = 40; __phoneComp.name = "Smartphone_01"; __phoneComp.numLayers = 4;
      var __phoneLayers = { 1: __mask, 2: __screen, 3: __guide, 4: __unreadableMatte };
      __phoneComp.layer = function (i) { return __phoneLayers[i]; };

      var __items = { 1: __phoneComp, 2: __screenComp, 3: __maskFootage };
      var app = { beginUndoGroup: function () {}, endUndoGroup: function () {}, project: { numItems: 3, item: function (i) { return __items[i]; } } };
    `;

    function scanPhone() {
      const result = JSON.parse(runFixedScriptWithoutNativeJson(buildScanProjectPreflightScript(), LAYER_ROLE_SETUP));
      expect(result.ok).toBe(true);
      return { result, phone: result.compositions.find((c: { compositionId: number }) => c.compositionId === 40) };
    }

    it("reports track-matte wiring from both sides - which layer IS a matte and which layer USES one, by AE enum key name and layer index", () => {
      const { phone } = scanPhone();
      expect(phone.layers[0].detail).toMatchObject({ isTrackMatte: true, hasTrackMatte: false, trackMatteType: "NO_TRACK_MATTE", trackMatteLayerIndex: null, sourceName: "Smartphone_01_Placeholder_Mask_1.mov", sourceCompositionId: null, opacityAtInPoint: 100, outPointSeconds: 4.5 });
      expect(phone.layers[1].detail).toMatchObject({ isTrackMatte: false, hasTrackMatte: true, trackMatteType: "LUMA", trackMatteLayerIndex: 1, sourceName: "_Place Image Above_1", sourceCompositionId: 50, parentLayerIndex: 1, blendingMode: "NORMAL", opacityKeyframeCount: 2, inPointSeconds: 0.5 });
    });

    it("reports a guide text layer's guide flag, zero opacity and a bounded text preview", () => {
      const { phone } = scanPhone();
      const guide = phone.layers[2];
      expect(guide.kind).toBe("TextLayer");
      expect(guide.detail.guideLayer).toBe(true);
      expect(guide.detail.opacityAtInPoint).toBe(0);
      expect(guide.detail.textPreview).toHaveLength(120);
      expect(guide.detail.textPreview.startsWith("PLACE YOUR IMAGE HERE ")).toBe(true);
    });

    it("keeps every other fact when a single fact throws on this AE build", () => {
      const { phone } = scanPhone();
      expect(phone.layers).toHaveLength(4);
      expect(phone.layers[3].detail).toMatchObject({ hasTrackMatte: true, trackMatteLayerIndex: null, opacityAtInPoint: 100 });
    });

    it("emits exactly the shape the worker's strict scan parser accepts, and the parser exposes it as the layer inventory", async () => {
      const { result } = scanPhone();
      const { parseProjectPreflightScan } = await import("../../inspection/parse-project-preflight-scan.js");
      const parsed = parseProjectPreflightScan(result);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.evidence.layerInventory.map((c) => c.compositionId)).toEqual([40, 50]);
      expect(parsed.evidence.layerInventory[0]?.layers[1]?.detail?.trackMatteType).toBe("LUMA");
    });
  });
});

describe("buildReopenProjectFromDiskScript (real 2026-09-14: a retry must never run on a failed run's unsaved edits)", () => {
  const setup = (openPath: string | null, exists = true) => `
    var __log = [];
    function File(path) { this.fsName = path; this.exists = ${exists ? "true" : "false"}; }
    var CloseOptions = { DO_NOT_SAVE_CHANGES: 1, SAVE_CHANGES: 2 };
    var app = {
      beginSuppressDialogs: function () {},
      endSuppressDialogs: function () {},
      project: {
        file: ${openPath === null ? "null" : `{ fsName: ${JSON.stringify(openPath)} }`},
        name: "open.aep",
        close: function (option) { __log.push("close:" + option); }
      },
      open: function (file) { __log.push("open:" + file.fsName); app.project = { file: { fsName: file.fsName }, name: "working-copy.aep", close: function () {} }; return app.project; }
    };
  `;
  const WORKING = "C:\\DYO-Agent\\execution-sessions\\s-1\\working-copy.aep";
  const run = (script: string, setupScript: string) =>
    JSON.parse(runFixedScriptWithoutNativeJson(script.replace(/return __result;\s*$/, `__result = JSON.stringify({ step: __result, log: __log });\n  return __result;`), setupScript));

  it("closes the SAME working copy without saving, then reopens it from disk", () => {
    const out = run(buildReopenProjectFromDiskScript(WORKING), setup(WORKING.toUpperCase()));
    expect(out.log).toEqual(["close:1", `open:${WORKING}`]);
    expect(JSON.parse(out.step)).toEqual({ ok: true, previousValue: { closedUnsavedCopy: true }, resultingValue: { openedPath: WORKING, openedName: "working-copy.aep" } });
  });

  it("never closes a different open project", () => {
    const out = run(buildReopenProjectFromDiskScript(WORKING), setup("C:\\somewhere\\else.aep"));
    expect(out.log).toEqual([`open:${WORKING}`]);
  });

  it("refuses when the working copy does not exist on disk - never opens or closes anything", () => {
    const out = run(buildReopenProjectFromDiskScript(WORKING), setup(WORKING, false));
    expect(out.log).toEqual([]);
    expect(JSON.parse(out.step).ok).toBe(false);
  });

  it("never saves", () => {
    const script = buildReopenProjectFromDiskScript(WORKING);
    expect(script).not.toMatch(/\.save\s*\(/);
    expect(script).not.toMatch(/\.SAVE_CHANGES\b/);
    expect(script).toContain("CloseOptions.DO_NOT_SAVE_CHANGES");
  });
});

describe("SET_TEXT/MAP_FOOTAGE with a nested target (live QA execution-wiring fix, 2026-09-08)", () => {
  /**
   * Fake AE object model for a real, 2-hop nested chain shaped exactly
   * like the live App Logo mapping's own tail (Pre-comp 3 [id 1635, item
   * index 11] -> App Logo [id 1113, item index 22]). `__precompLayer4`
   * (index 4, within Pre-comp 3) is the real precomp-reference layer whose
   * `.source` IS the App Logo composition - every nested resolution below
   * must verify this relationship live, never assume it. The App Logo
   * composition itself carries BOTH a TextLayer (index 1) and an AVLayer
   * (index 2, with a real footage-replaceable `.source`), so the exact
   * same fake app can exercise both SET_TEXT and MAP_FOOTAGE nested
   * mutations.
   */
  const NESTED_FAKE_APP_SETUP = `
    function CompItem() {}
    function AVLayer() {}
    AVLayer.prototype = Object.create(CompItem.prototype);
    function TextLayer() {}
    TextLayer.prototype = new AVLayer();

    var __logoComp = new CompItem();
    __logoComp.id = 1113;
    __logoComp.name = "App Logo";
    var __logoTextLayer = new TextLayer();
    __logoTextLayer.index = 1;
    __logoTextLayer.sourceText = { value: { text: "old text" }, setValue: function (v) { this.value = v; } };
    var __existingFootageSource = new CompItem();
    __existingFootageSource.name = "workshop_logo__.png";
    var __logoImageLayer = new AVLayer();
    __logoImageLayer.index = 2;
    __logoImageLayer.source = __existingFootageSource;
    __logoImageLayer.replaceSource = function (newItem) { this.source = newItem; };
    var __logoLayersByIndex = { 1: __logoTextLayer, 2: __logoImageLayer };
    // Real AE throws for an out-of-range layer index, it never returns
    // undefined - matched here so the "layer not found" fail-closed path
    // is exercised the same way it would be against real AE.
    __logoComp.layer = function (i) {
      var __l = __logoLayersByIndex[i];
      if (__l === undefined) { throw new Error("layer index out of range"); }
      return __l;
    };

    var __precompComp = new CompItem();
    __precompComp.id = 1635;
    __precompComp.name = "Pre-comp 3";
    var __precompLayer4 = new AVLayer();
    __precompLayer4.index = 4;
    __precompLayer4.source = __logoComp;
    var __precompLayersByIndex = { 4: __precompLayer4 };
    __precompComp.layer = function (i) { return __precompLayersByIndex[i]; };

    var __itemsByIndex = { 11: __precompComp, 22: __logoComp };
    var app = {
      beginUndoGroup: function () {},
      endUndoGroup: function () {},
      project: {
        numItems: 30,
        item: function (i) { return __itemsByIndex[i]; },
        importFile: function (opts) { return { name: opts.file.fsName }; }
      }
    };
    function File(path) { this.fsName = path; this.exists = true; }
    function ImportOptions(file) { this.file = file; }
  `;

  const NESTED_TARGET = [
    { compositionId: "comp-1635", aeProjectItemIndex: 11, layerIndex: 4 },
    { compositionId: "comp-1113", aeProjectItemIndex: 22, layerIndex: 1 }
  ];

  it("nested text sourceText replacement: descends through the real precomp reference and mutates the final TextLayer's sourceText", () => {
    const op: SceneEditOperation = {
      type: "SET_TEXT",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: NESTED_TARGET,
      text: "מבית DYO App"
    };
    const script = buildOperationScript(999, "irrelevant - nested resolution never uses this", op);
    const resultText = runFixedScriptWithoutNativeJson(script, NESTED_FAKE_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result).toEqual({ ok: true, previousValue: "old text", resultingValue: "מבית DYO App" });
  });

  it("real 2026-09-14: a LOCKED text layer gets its new text and is locked again afterwards", () => {
    const lockedTextSetup = `${NESTED_FAKE_APP_SETUP}
      __logoTextLayer.locked = true;
      __logoTextLayer.sourceText.setValue = function (v) { if (__logoTextLayer.locked) { throw new Error("the Layer is locked"); } this.value = v; };
    `;
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: null, layerIndex: null, nestedTarget: NESTED_TARGET, text: "מבית DYO App" };
    const script = buildOperationScript(999, "irrelevant", op).replace(/return __result;\s*$/, "__result = JSON.stringify({ step: __result, locked: __logoTextLayer.locked, text: __logoTextLayer.sourceText.value.text });\n  return __result;");
    const outcome = JSON.parse(runFixedScriptWithoutNativeJson(script, lockedTextSetup));
    expect(JSON.parse(outcome.step)).toEqual({ ok: true, previousValue: "old text", resultingValue: "מבית DYO App" });
    expect(outcome.text).toBe("מבית DYO App");
    expect(outcome.locked).toBe(true);
  });

  it("nested logo asset replacement: descends through the real precomp reference and replaces the final AVLayer's footage source", () => {
    const op: SceneEditOperation = {
      type: "MAP_FOOTAGE",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: [
        { compositionId: "comp-1635", aeProjectItemIndex: 11, layerIndex: 4 },
        { compositionId: "comp-1113", aeProjectItemIndex: 22, layerIndex: 2 }
      ],
      assetPath: "/real/dyo-logo.png"
    };
    const script = buildOperationScript(999, "irrelevant", op);
    const resultText = runFixedScriptWithoutNativeJson(script, NESTED_FAKE_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    expect(result.previousValue).toBe("workshop_logo__.png");
    expect(result.resultingValue).toBe("/real/dyo-logo.png");
  });

  describe("screen card replacement (Mixkit 'place image above' slots: a 1242x2688 solid under guide labels)", () => {
    type CardOptions = { animatedScale?: boolean; locked?: boolean; moveIgnored?: boolean; fillStuck?: boolean };
    const cardSetup = (options: CardOptions = {}) => `
      ${NESTED_FAKE_APP_SETUP}
      function SolidSource() {}
      // A template card solid colours itself with an "ADBE Fill" effect; an
      // unrelated effect sits next to it. The ordinary footage layer (index 2)
      // carries the same pair, so non-card replacement can prove it is untouched.
      function __makeEffect(matchName, name, stuck) {
        var __value = true;
        var __e = { matchName: matchName, name: name };
        Object.defineProperty(__e, "enabled", {
          get: function () { return __value; },
          set: function (v) { if (stuck) { throw new Error("Can not set enabled on this effect."); } __value = v; }
        });
        return __e;
      }
      function __makeParade(effects) {
        return { numProperties: effects.length, property: function (i) { return effects[i - 1]; } };
      }
      var __cardFill = __makeEffect("ADBE Fill", "Fill", ${options.fillStuck ? "true" : "false"});
      var __cardBlur = __makeEffect("ADBE Gaussian Blur 2", "Gaussian Blur", false);
      var __otherFill = __makeEffect("ADBE Fill", "Fill", false);
      var __otherBlur = __makeEffect("ADBE Gaussian Blur 2", "Gaussian Blur", false);
      __logoImageLayer.property = function (name) { return name === "ADBE Effect Parade" ? __makeParade([__otherFill, __otherBlur]) : null; };
      var __moved = false;
      var __anchorValue = [621, 1344, 0];
      var __scaleValue = [100, 100, 100];
      var __card = new AVLayer();
      __card.index = 3;
      __card.locked = ${options.locked ? "true" : "false"};
      __card.source = { name: "Placeholder", width: 1242, height: 2688, mainSource: new SolidSource() };
      __card.replaceSource = function (newItem) { this.source = newItem; };
      // Real AE behavior: a locked layer refuses to be re-ordered.
      __card.moveToBeginning = function () {
        if (this.locked) { throw new Error("Can not call method moveToBeginning because the Layer is locked."); }
        __moved = true;
        ${options.moveIgnored ? "" : "this.index = 1;"}
      };
      __card.property = function (name) {
        if (name === "ADBE Effect Parade") { return __makeParade([__cardFill, __cardBlur]); }
        if (name !== "ADBE Transform Group") { return null; }
        return {
          property: function (inner) {
            if (inner === "ADBE Scale") { return { numKeys: ${options.animatedScale ? 2 : 0}, value: __scaleValue, setValue: function (v) { __scaleValue = v; } }; }
            if (inner === "ADBE Anchor Point") { return { numKeys: 0, value: __anchorValue, setValue: function (v) { __anchorValue = v; } }; }
            return null;
          }
        };
      };
      __logoLayersByIndex[3] = __card;
      app.project.importFile = function (opts) { return { name: opts.file.fsName, width: 1080, height: 2340 }; };
    `;
    const cardOp: SceneEditOperation = {
      type: "MAP_FOOTAGE",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: [
        { compositionId: "comp-1635", aeProjectItemIndex: 11, layerIndex: 4 },
        { compositionId: "comp-1113", aeProjectItemIndex: 22, layerIndex: 3 }
      ],
      assetPath: "/real/app-screenshot.png"
    };
    // ExtendScript has no JSON.parse (only the stringify polyfill), so the
    // step's own result travels back as a string and is parsed out here.
    const probe = "; __result = JSON.stringify({ step: __result, moved: __moved, scale: __scaleValue, anchor: __anchorValue, locked: __card.locked, cardFill: __cardFill.enabled, cardBlur: __cardBlur.enabled, otherFill: __otherFill.enabled, otherBlur: __otherBlur.enabled });";

    function runProbed(op: SceneEditOperation, options: CardOptions = {}) {
      const script = buildOperationScript(999, "irrelevant", op);
      // Reads the fake's state after the real script body ran, inside the same function.
      const probed = script.replace(/return __result;\s*$/, `${probe}\n  return __result;`);
      expect(probed).not.toBe(script);
      const outcome = JSON.parse(runFixedScriptWithoutNativeJson(probed, cardSetup(options)));
      return { ...outcome, step: JSON.parse(outcome.step) };
    }

    const runCard = (options: CardOptions = {}) => runProbed(cardOp, options);

    it("verifies the ordering: a move that leaves the media below the guide labels is reported as failed, and the lock is still restored", () => {
      const outcome = runCard({ locked: true, moveIgnored: true });
      expect(outcome.step.ok).toBe(false);
      expect(outcome.step.failureReason).toMatch(/not moved to the top of its composition/);
      expect(outcome.locked).toBe(true);
    });

    it("real 2026-09-14 failure: a designer-LOCKED card is unlocked only for the fill, then locked again - never left unlocked, never refused", () => {
      const outcome = runCard({ locked: true });
      expect(outcome.step).toEqual({ ok: true, previousValue: "Placeholder", resultingValue: "/real/app-screenshot.png" });
      expect(outcome.moved).toBe(true);
      expect(outcome.scale[0]).toBeCloseTo(115, 6);
      expect(outcome.locked).toBe(true);
    });

    it("an unlocked card stays unlocked after the fill", () => {
      const outcome = runCard();
      expect(outcome.step.ok).toBe(true);
      expect(outcome.locked).toBe(false);
    });

    it("scales the media to cover the card's own area, keeps the card's relative anchor, and raises it above the guide labels", () => {
      const outcome = runCard();
      expect(outcome.step).toEqual({ ok: true, previousValue: "Placeholder", resultingValue: "/real/app-screenshot.png" });
      // cover = max(1242/1080, 2688/2340) = 1.15
      expect(outcome.scale[0]).toBeCloseTo(115, 6);
      expect(outcome.scale[1]).toBeCloseTo(115, 6);
      expect(outcome.scale[2]).toBe(100);
      expect(outcome.anchor).toEqual([540, 1170, 0]);
      expect(outcome.moved).toBe(true);
    });

    it("refuses to guess a fit for a card with animated scale, and says so", () => {
      const outcome = runCard({ animatedScale: true });
      expect(outcome.step.ok).toBe(false);
      expect(outcome.step.failureReason).toMatch(/animated scale or anchor/);
      expect(outcome.moved).toBe(false);
    });

    it("leaves ordinary footage replacement untouched - no fit, no reordering, effects unchanged", () => {
      const outcome = runProbed({ ...cardOp, nestedTarget: [cardOp.nestedTarget![0]!, { ...cardOp.nestedTarget![1]!, layerIndex: 2 }] });
      expect(outcome.step.ok).toBe(true);
      expect(outcome.moved).toBe(false);
      expect(outcome.scale).toEqual([100, 100, 100]);
      expect(outcome.otherFill).toBe(true);
      expect(outcome.otherBlur).toBe(true);
    });

    it("real 2026-09-16: switches off the card solid's own Fill effect so the media is not painted one flat colour, and leaves other effects on", () => {
      const outcome = runCard();
      expect(outcome.step).toEqual({ ok: true, previousValue: "Placeholder", resultingValue: "/real/app-screenshot.png" });
      expect(outcome.cardFill).toBe(false);
      expect(outcome.cardBlur).toBe(true);
    });

    it("a Fill effect that cannot be switched off fails the operation with its name - never a silent flat card - and the lock is still restored", () => {
      const outcome = runCard({ locked: true, fillStuck: true });
      expect(outcome.step.ok).toBe(false);
      expect(outcome.step.failureReason).toMatch(/Fill effect "Fill" could not be switched off/);
      expect(outcome.cardFill).toBe(true);
      expect(outcome.locked).toBe(true);
    });

    it("a card whose fit already failed is reported for that reason, with its effects untouched", () => {
      const outcome = runCard({ animatedScale: true });
      expect(outcome.step.failureReason).toMatch(/animated scale or anchor/);
      expect(outcome.cardFill).toBe(true);
    });
  });

  describe("logo contain fit on a screen card (real 2026-09-16: a near-square logo was cover-cropped to a slice of a tall card)", () => {
    type ContainOptions = { anchor?: number[]; position?: number[]; scale?: number[]; rotation?: number; animatedPosition?: boolean; locked?: boolean };
    const containSetup = (options: ContainOptions = {}) => `
      ${NESTED_FAKE_APP_SETUP}
      function SolidSource() {}
      var __order = [];
      var __added = null;
      var __cardSourceReplaced = false;
      function __reindex() { for (var i = 0; i < __order.length; i++) { __order[i].index = i + 1; } }
      function __moveToFront(l) { __order.splice(__order.indexOf(l), 1); __order.unshift(l); __reindex(); }
      function __makeProp(v, keys) { return { numKeys: keys, value: v, setValue: function (x) { this.value = x; } }; }
      function __makeTransform(v) {
        var props = {
          "ADBE Anchor Point": __makeProp(v.anchor, 0),
          "ADBE Position": __makeProp(v.position, v.animatedPosition ? 2 : 0),
          "ADBE Scale": __makeProp(v.scale, 0),
          "ADBE Rotate Z": __makeProp(v.rotation, 0)
        };
        return { props: props, property: function (n) { return props[n] || null; } };
      }
      var __labelApp = new TextLayer(); __labelApp.name = "APP SCREEN";
      var __labelNumber = new TextLayer(); __labelNumber.name = "2";
      var __card = new AVLayer();
      __card.name = "Placeholder";
      __card.locked = ${options.locked ? "true" : "false"};
      __card.parent = null;
      __card.startTime = 0; __card.inPoint = 0; __card.outPoint = 64;
      __card.source = { name: "Placeholder", width: 1242, height: 2648, mainSource: new SolidSource() };
      var __cardTransform = __makeTransform({
        anchor: ${JSON.stringify(options.anchor ?? [621, 1324, 0])},
        position: ${JSON.stringify(options.position ?? [621, 1324, 0])},
        scale: ${JSON.stringify(options.scale ?? [100, 100, 100])},
        rotation: ${options.rotation ?? 0},
        animatedPosition: ${options.animatedPosition ? "true" : "false"}
      });
      __card.property = function (n) { return n === "ADBE Transform Group" ? __cardTransform : null; };
      __card.replaceSource = function () { __cardSourceReplaced = true; };
      __card.moveToBeginning = function () {
        if (this.locked) { throw new Error("Can not call method moveToBeginning because the Layer is locked."); }
        __moveToFront(this);
      };
      __card.containingComp = {
        layers: {
          add: function (item) {
            var l = new AVLayer();
            l.name = item.name; l.source = item; l.parent = null;
            l.startTime = 0; l.inPoint = 0; l.outPoint = 999;
            l.transform = __makeTransform({ anchor: [0, 0, 0], position: [0, 0, 0], scale: [100, 100, 100], rotation: 0 });
            l.property = function (n) { return n === "ADBE Transform Group" ? this.transform : null; };
            l.moveToBeginning = function () { __moveToFront(this); };
            __order.unshift(l); __reindex(); __added = l;
            return l;
          }
        }
      };
      __order = [__labelApp, __labelNumber, __card];
      __reindex();
      __logoLayersByIndex[3] = __card;
      app.project.importFile = function (opts) { return { name: opts.file.fsName, width: 469, height: 533 }; };
    `;
    const logoOp: SceneEditOperation = {
      type: "MAP_FOOTAGE",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: [
        { compositionId: "comp-1635", aeProjectItemIndex: 11, layerIndex: 4 },
        { compositionId: "comp-1113", aeProjectItemIndex: 22, layerIndex: 3 }
      ],
      assetPath: "/real/app-logo.png",
      fit: "contain"
    };
    const probe =
      "; var __names = []; for (var __i = 0; __i < __order.length; __i++) { __names.push(__order[__i].name); }" +
      " __result = JSON.stringify({ step: __result, order: __names, cardSourceName: __card.source.name, cardSourceReplaced: __cardSourceReplaced, locked: __card.locked," +
      " media: __added ? { anchor: __added.transform.props['ADBE Anchor Point'].value, position: __added.transform.props['ADBE Position'].value, scale: __added.transform.props['ADBE Scale'].value, rotation: __added.transform.props['ADBE Rotate Z'].value, startTime: __added.startTime, inPoint: __added.inPoint, outPoint: __added.outPoint } : null," +
      " logoSourceName: __logoImageLayer.source.name });";

    function runContain(op: SceneEditOperation, options: ContainOptions = {}) {
      const script = buildOperationScript(999, "irrelevant", op);
      const probed = script.replace(/return __result;\s*$/, `${probe}\n  return __result;`);
      expect(probed).not.toBe(script);
      const outcome = JSON.parse(runFixedScriptWithoutNativeJson(probed, containSetup(options)));
      return { ...outcome, step: JSON.parse(outcome.step) };
    }

    it("adds the whole logo above the card, centred and uniformly scaled so it fits - never cropped, never stretched - and keeps the card as its background above the guide labels", () => {
      const outcome = runContain(logoOp);
      expect(outcome.step).toEqual({ ok: true, previousValue: "Placeholder", resultingValue: "/real/app-logo.png" });
      expect(outcome.order).toEqual(["/real/app-logo.png", "Placeholder", "APP SCREEN", "2"]);
      expect(outcome.cardSourceReplaced).toBe(false);
      expect(outcome.cardSourceName).toBe("Placeholder");
      // contain = min(1242/469, 2648/533) = 1242/469: full width, height 1411 of 2648.
      const factor = (1242 / 469) * 100;
      expect(outcome.media.scale[0]).toBeCloseTo(factor, 6);
      expect(outcome.media.scale[1]).toBeCloseTo(factor, 6);
      expect(outcome.media.scale[2]).toBe(100);
      expect((469 * outcome.media.scale[0]) / 100).toBeLessThanOrEqual(1242 + 1e-6);
      expect((533 * outcome.media.scale[1]) / 100).toBeLessThanOrEqual(2648 + 1e-6);
      expect(outcome.media.anchor).toEqual([234.5, 266.5, 0]);
      expect(outcome.media.position).toEqual([621, 1324, 0]);
      expect(outcome.media.rotation).toBe(0);
      expect([outcome.media.startTime, outcome.media.inPoint, outcome.media.outPoint]).toEqual([0, 0, 64]);
    });

    it("centres on a rotated, non-uniformly scaled card through its own anchor, scale and rotation, and still scales the logo uniformly", () => {
      const outcome = runContain(logoOp, { anchor: [0, 0, 0], position: [100, 200, 0], scale: [50, 100, 100], rotation: 90 });
      expect(outcome.step.ok).toBe(true);
      // Card centre offset (621*0.5, 1324*1) rotated 90 degrees: (-1324, 310.5).
      expect(outcome.media.position[0]).toBeCloseTo(100 - 1324, 6);
      expect(outcome.media.position[1]).toBeCloseTo(200 + 310.5, 6);
      // Rendered card 621 x 2648 -> contain = 621/469.
      expect(outcome.media.scale[0]).toBeCloseTo((621 / 469) * 100, 6);
      expect(outcome.media.scale[1]).toBeCloseTo(outcome.media.scale[0], 9);
      expect(outcome.media.rotation).toBe(90);
    });

    it("refuses a card with animated position - no layer added, the card left as it was", () => {
      const outcome = runContain(logoOp, { animatedPosition: true });
      expect(outcome.step.ok).toBe(false);
      expect(outcome.step.failureReason).toMatch(/animated scale, anchor point, position or rotation/);
      expect(outcome.media).toBeNull();
      expect(outcome.order).toEqual(["APP SCREEN", "2", "Placeholder"]);
    });

    it("a designer-locked card is unlocked only for the fit and locked again", () => {
      const outcome = runContain(logoOp, { locked: true });
      expect(outcome.step.ok).toBe(true);
      expect(outcome.order[0]).toBe("/real/app-logo.png");
      expect(outcome.locked).toBe(true);
    });

    it("a contain fit on a layer that is not a solid card is a plain source swap - nothing added", () => {
      const outcome = runContain({ ...logoOp, nestedTarget: [logoOp.nestedTarget![0]!, { ...logoOp.nestedTarget![1]!, layerIndex: 2 }] });
      expect(outcome.step).toEqual({ ok: true, previousValue: "workshop_logo__.png", resultingValue: "/real/app-logo.png" });
      expect(outcome.media).toBeNull();
      expect(outcome.logoSourceName).toBe("/real/app-logo.png");
    });

    it("without a fit, a screen card keeps the cover path (source swap) - the contain branch is not even in the script", () => {
      const { fit: _fit, ...coverOp } = logoOp;
      const script = buildOperationScript(999, "irrelevant", coverOp as SceneEditOperation);
      expect(script).not.toContain("layers.add(__newFootageItem)");
      expect(script).toContain("__layer.replaceSource(__newFootageItem, false)");
    });
  });

  it("multi-hop traversal: a 3-hop chain resolves through two intermediate precomp hops before reaching the final layer", () => {
    const threeHopSetup = `
      function CompItem() {}
      function AVLayer() {}
      AVLayer.prototype = Object.create(CompItem.prototype);
      function TextLayer() {}
      TextLayer.prototype = new AVLayer();

      var __final = new CompItem();
      __final.id = 300;
      __final.name = "Final";
      var __finalText = new TextLayer();
      __finalText.index = 1;
      __finalText.sourceText = { value: { text: "before" }, setValue: function (v) { this.value = v; } };
      __final.layer = function (i) { return i === 1 ? __finalText : null; };

      var __mid = new CompItem();
      __mid.id = 200;
      __mid.name = "Mid";
      var __midLayer = new AVLayer();
      __midLayer.index = 2;
      __midLayer.source = __final;
      __mid.layer = function (i) { return i === 2 ? __midLayer : null; };

      var __outer = new CompItem();
      __outer.id = 100;
      __outer.name = "Outer";
      var __outerLayer = new AVLayer();
      __outerLayer.index = 3;
      __outerLayer.source = __mid;
      __outer.layer = function (i) { return i === 3 ? __outerLayer : null; };

      var __itemsByIndex = { 10: __outer, 20: __mid, 30: __final };
      var app = {
        beginUndoGroup: function () {},
        endUndoGroup: function () {},
        project: { numItems: 40, item: function (i) { return __itemsByIndex[i]; } }
      };
    `;
    const op: SceneEditOperation = {
      type: "SET_TEXT",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: [
        { compositionId: "comp-100", aeProjectItemIndex: 10, layerIndex: 3 },
        { compositionId: "comp-200", aeProjectItemIndex: 20, layerIndex: 2 },
        { compositionId: "comp-300", aeProjectItemIndex: 30, layerIndex: 1 }
      ],
      text: "after"
    };
    const script = buildOperationScript(999, "irrelevant", op);
    const resultText = runFixedScriptWithoutNativeJson(script, threeHopSetup);
    const result = JSON.parse(resultText);
    expect(result).toEqual({ ok: true, previousValue: "before", resultingValue: "after" });
  });

  it("stale/broken path fails closed: an intermediate hop's real composition id no longer matches the expected one (e.g. the project was re-ordered) - never guesses, never mutates", () => {
    const staleSetup = NESTED_FAKE_APP_SETUP.replace("__precompComp.id = 1635;", "__precompComp.id = 9999;");
    const op: SceneEditOperation = {
      type: "SET_TEXT",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: NESTED_TARGET,
      text: "should never be applied"
    };
    const script = buildOperationScript(999, "irrelevant", op);
    const resultText = runFixedScriptWithoutNativeJson(script, staleSetup);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("stale or broken nested path");
    expect(result.failureReason).toContain("1635");
  });

  it("stale/broken path fails closed: an intermediate layer no longer references the expected next composition (e.g. the template's precomp reference changed) - never guesses, never mutates", () => {
    const retargetedSetup = NESTED_FAKE_APP_SETUP.replace("__precompLayer4.source = __logoComp;", "__precompLayer4.source = new CompItem();");
    const op: SceneEditOperation = {
      type: "SET_TEXT",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: NESTED_TARGET,
      text: "should never be applied"
    };
    const script = buildOperationScript(999, "irrelevant", op);
    const resultText = runFixedScriptWithoutNativeJson(script, retargetedSetup);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("stale or broken nested path");
  });

  it("real 2026-09-14 failure: resolves every step by durable id even when an earlier import shifted every stored project item index", () => {
    // Each composition now lives one index later than the stored hint (11 -> 12, 22 -> 23), and the
    // hinted indices hold unrelated compositions - exactly what a MAP_FOOTAGE import does mid-job.
    const driftedSetup = `${NESTED_FAKE_APP_SETUP}
      var __unrelatedA = new CompItem(); __unrelatedA.id = 7001; __unrelatedA.name = "Neighbour A";
      var __unrelatedB = new CompItem(); __unrelatedB.id = 7002; __unrelatedB.name = "Neighbour B";
      __itemsByIndex = { 11: __unrelatedA, 12: __precompComp, 22: __unrelatedB, 23: __logoComp };
    `;
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: null, layerIndex: null, nestedTarget: NESTED_TARGET, text: "מבית DYO App" };
    const result = JSON.parse(runFixedScriptWithoutNativeJson(buildOperationScript(999, "irrelevant", op), driftedSetup));
    expect(result).toEqual({ ok: true, previousValue: "old text", resultingValue: "מבית DYO App" });
  });

  it("refuses an ambiguous step: two compositions carrying the same id are never guessed between", () => {
    const ambiguousSetup = `${NESTED_FAKE_APP_SETUP}
      var __twin = new CompItem(); __twin.id = 1113; __twin.name = "App Logo copy";
      __itemsByIndex[25] = __twin;
    `;
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: null, layerIndex: null, nestedTarget: NESTED_TARGET, text: "should never be applied" };
    const result = JSON.parse(runFixedScriptWithoutNativeJson(buildOperationScript(999, "irrelevant", op), ambiguousSetup));
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("2 compositions share id 1113");
    expect(result.failureReason).toContain("ambiguous");
  });

  it("wrong composition fails closed: no composition with a step's durable id exists anywhere in the project", () => {
    const op: SceneEditOperation = {
      type: "SET_TEXT",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: [{ compositionId: "comp-9999", aeProjectItemIndex: 500, layerIndex: 1 }],
      text: "should never be applied"
    };
    const script = buildOperationScript(999, "irrelevant", op);
    const resultText = runFixedScriptWithoutNativeJson(script, NESTED_FAKE_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("no composition with id 9999");
  });

  it("wrong composition/layer fails closed: the final step's layerIndex does not exist in the final composition", () => {
    const op: SceneEditOperation = {
      type: "SET_TEXT",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: [
        { compositionId: "comp-1635", aeProjectItemIndex: 11, layerIndex: 4 },
        { compositionId: "comp-1113", aeProjectItemIndex: 22, layerIndex: 99 }
      ],
      text: "should never be applied"
    };
    const script = buildOperationScript(999, "irrelevant", op);
    const resultText = runFixedScriptWithoutNativeJson(script, NESTED_FAKE_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("was not found in the final target composition");
  });

  it("direct humanLayerIndex still works (flat, same-composition case) - unaffected by nested-target support existing alongside it", () => {
    const flatSetup = `
      function CompItem() {}
      function AVLayer() {}
      AVLayer.prototype = Object.create(CompItem.prototype);
      function TextLayer() {}
      TextLayer.prototype = new AVLayer();
      var __comp = new CompItem();
      __comp.name = ${JSON.stringify(COMP_NAME)};
      var __textLayer = new TextLayer();
      __textLayer.index = 7;
      __textLayer.sourceText = { value: { text: "flat before" }, setValue: function (v) { this.value = v; } };
      __comp.layer = function (i) { return i === 7 ? __textLayer : null; };
      var app = {
        beginUndoGroup: function () {},
        endUndoGroup: function () {},
        project: { numItems: 1, item: function (i) { return i === 1 ? __comp : null; } }
      };
    `;
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: null, layerIndex: 7, nestedTarget: null, text: "flat after" };
    const script = buildOperationScript(1, COMP_NAME, op);
    const resultText = runFixedScriptWithoutNativeJson(script, flatSetup);
    const result = JSON.parse(resultText);
    expect(result).toEqual({ ok: true, previousValue: "flat before", resultingValue: "flat after" });
  });

  it("never mutates the source AEP directly - the nested script never calls app.project.save() or anything file-writing beyond the layer/footage mutation itself", () => {
    const script = buildOperationScript(999, "irrelevant", {
      type: "SET_TEXT",
      manifestPlaceholderId: null,
      layerIndex: null,
      nestedTarget: NESTED_TARGET,
      text: "x"
    });
    expect(script).not.toContain("app.project.save(");
  });
});

describe("BUILD_REELS_COMPOSITION (native Reels, 2026-08-29 closure requirement)", () => {
  function op(overrides: Partial<Extract<SceneEditOperation, { type: "BUILD_REELS_COMPOSITION" }>> = {}): SceneEditOperation {
    return {
      type: "BUILD_REELS_COMPOSITION",
      reelsCompositionName: "Scene 01 - Reels",
      layerTransforms: [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }],
      ...overrides
    };
  }

  it("resolves and name-verifies the SOURCE composition before touching anything, the same as every other operation", () => {
    const script = buildOperationScript(5, "Scene 01", op());
    expect(script).toContain("app.project.item(5)");
    expect(script).toContain("__comp.name !== " + JSON.stringify("Scene 01"));
    expect(script).toContain("refusing to mutate the wrong composition");
  });

  it("uses AE's native, non-destructive CompItem.duplicate() - never deletes/replaces the source composition itself", () => {
    const script = buildOperationScript(5, "Scene 01", op());
    expect(script).toContain("__comp.duplicate()");
    expect(script).not.toMatch(/__comp\.remove\(\)/);
  });

  it("removes any PRIOR composition with the same reelsCompositionName first, so re-execution never accumulates duplicates", () => {
    const script = buildOperationScript(5, "Scene 01", op({ reelsCompositionName: "Reels Take 2" }));
    expect(script).toContain(JSON.stringify("Reels Take 2"));
    expect(script).toContain("__existingIndex !== null");
    expect(script).toContain("app.project.item(__existingIndex).remove()");
  });

  it("resizes ONLY the new duplicate to the fixed 1080x1920 frame - never a caller-supplied dimension", () => {
    const script = buildOperationScript(5, "Scene 01", op());
    expect(script).toContain("__newComp.width = 1080");
    expect(script).toContain("__newComp.height = 1920");
  });

  it("refuses (typed failure) to reposition a layer whose position or scale already has real keyframes - never silently destroys existing animation", () => {
    const script = buildOperationScript(5, "Scene 01", op());
    expect(script).toContain("__targetLayer.transform.position.numKeys > 0");
    expect(script).toContain("__targetLayer.transform.scale.numKeys > 0");
    expect(script).toContain("refusing to overwrite it and destroy that animation");
  });

  it("rolls back (removes the half-built duplicate) if any layer transform fails partway through", () => {
    const script = buildOperationScript(5, "Scene 01", op());
    const failureAssignIndex = script.indexOf("__transformFailure = \"layer index \"");
    const rollbackIndex = script.indexOf("__newComp.remove();");
    expect(failureAssignIndex).toBeGreaterThan(-1);
    expect(rollbackIndex).toBeGreaterThan(failureAssignIndex);
  });

  it("applies explicit, human-supplied position/scale values only - never computes or guesses a coordinate", () => {
    const script = buildOperationScript(5, "Scene 01", op({ layerTransforms: [{ layerIndex: 3, manifestPlaceholderId: null, positionX: 100, positionY: 200, scalePercent: 75 }] }));
    expect(script).toContain(JSON.stringify([{ layerIndex: 3, positionX: 100, positionY: 200, scalePercent: 75 }]));
    expect(script).toContain("__targetLayer.transform.position.setValue([__tx.positionX, __tx.positionY])");
    expect(script).toContain("__targetLayer.transform.scale.setValue([__tx.scalePercent, __tx.scalePercent])");
  });

  it("wraps in beginUndoGroup/try/finally/endUndoGroup like every other script", () => {
    const script = buildOperationScript(5, "Scene 01", op());
    expect(script).toContain("app.beginUndoGroup(");
    expect(script).toContain("app.endUndoGroup();");
    expect(script).toContain("try {");
    expect(script).toContain("finally {");
  });

  it("is a bare function BODY, never a self-invoking expression", () => {
    const script = buildOperationScript(5, "Scene 01", op());
    expect(script).not.toMatch(/^\s*\(function\s*\(/);
    expect(script.trim().endsWith("return __result;")).toBe(true);
  });

  it("reports the new composition's real identity AND dimensions/duration/frameRate read back from the real CompItem, never fabricated/guessed", () => {
    const script = buildOperationScript(5, "Scene 01", op());
    expect(script).toContain("reelsAeProjectItemIndex: __newIndex");
    expect(script).toContain("reelsCompositionName: __newComp.name");
    expect(script).toContain("reelsWidthPx: __newComp.width");
    expect(script).toContain("reelsHeightPx: __newComp.height");
    expect(script).toContain("reelsDurationSeconds: __newComp.duration");
    expect(script).toContain("reelsFrameRate: __newComp.frameRate");
  });

  it("is deterministic - the same operation always produces byte-identical JSX", () => {
    expect(buildOperationScript(5, "Scene 01", op())).toBe(buildOperationScript(5, "Scene 01", op()));
  });
});

describe("BUILD_HORIZONTAL_COMPOSITION (native Landscape, live QA 2026-09-10 urgent request)", () => {
  function op(overrides: Partial<Extract<SceneEditOperation, { type: "BUILD_HORIZONTAL_COMPOSITION" }>> = {}): SceneEditOperation {
    return {
      type: "BUILD_HORIZONTAL_COMPOSITION",
      horizontalCompositionName: "!Render (Landscape)",
      ...overrides
    };
  }

  it("resolves and name-verifies the SOURCE composition before touching anything, the same as every other operation", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("app.project.item(2)");
    expect(script).toContain("__comp.name !== " + JSON.stringify("!Render"));
    expect(script).toContain("refusing to mutate the wrong composition");
  });

  it("uses AE's native, non-destructive CompItem.duplicate() - never deletes/replaces the source composition itself", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("__comp.duplicate()");
    expect(script).not.toMatch(/__comp\.remove\(\)/);
  });

  it("removes any PRIOR composition with the same horizontalCompositionName first, so re-execution never accumulates duplicates", () => {
    const script = buildOperationScript(2, "!Render", op({ horizontalCompositionName: "Landscape Take 2" }));
    expect(script).toContain(JSON.stringify("Landscape Take 2"));
    expect(script).toContain("__existingIndex !== null");
    expect(script).toContain("app.project.item(__existingIndex).remove()");
  });

  it("resizes ONLY the new duplicate to the fixed 1920x1080 frame - never a caller-supplied dimension", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("__newComp.width = 1920");
    expect(script).toContain("__newComp.height = 1080");
  });

  it("never accepts a caller-supplied layout - no layerTransforms field anywhere, unlike BUILD_REELS_COMPOSITION", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).not.toContain("layerTransforms");
  });

  it("refuses (typed failure) to adapt a layer whose position or scale already has real keyframes - never silently destroys existing animation", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("__layer.transform.position.numKeys > 0");
    expect(script).toContain("__layer.transform.scale.numKeys > 0");
    expect(script).toContain("refusing to overwrite it and destroy that animation");
  });

  it("refuses (typed failure) to adapt a 3D layer - 2D geometry math does not apply safely", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("__layer.threeDLayer");
    expect(script).toContain("is a 3D layer");
  });

  it("refuses (typed failure) to adapt a layer parented to another layer - a partial reposition would silently produce the wrong final position", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("__layer.parent !== null");
    expect(script).toContain("is parented to another layer");
  });

  it("skips (never refuses) a disabled layer or a layer with no video component - nothing to adapt", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("if (!__layer.enabled) { continue; }");
    expect(script).toContain("if (!__layer.hasVideo) { continue; }");
  });

  it("rolls back (removes the half-built duplicate) if any layer cannot be safely adapted", () => {
    const script = buildOperationScript(2, "!Render", op());
    const failureAssignIndex = script.indexOf('__adaptFailure = "layer " + __li');
    const rollbackIndex = script.indexOf("__newComp.remove();");
    expect(failureAssignIndex).toBeGreaterThan(-1);
    expect(rollbackIndex).toBeGreaterThan(failureAssignIndex);
  });

  it("reports the new composition's real identity AND dimensions/duration/frameRate read back from the real CompItem, never fabricated/guessed", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("horizontalAeProjectItemIndex: __newIndex");
    expect(script).toContain("horizontalCompositionName: __newComp.name");
    expect(script).toContain("horizontalWidthPx: __newComp.width");
    expect(script).toContain("horizontalHeightPx: __newComp.height");
    expect(script).toContain("horizontalDurationSeconds: __newComp.duration");
    expect(script).toContain("horizontalFrameRate: __newComp.frameRate");
  });

  it("wraps in beginUndoGroup/try/finally/endUndoGroup like every other script", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).toContain("app.beginUndoGroup(");
    expect(script).toContain("app.endUndoGroup();");
    expect(script).toContain("try {");
    expect(script).toContain("finally {");
  });

  it("is a bare function BODY, never a self-invoking expression", () => {
    const script = buildOperationScript(2, "!Render", op());
    expect(script).not.toMatch(/^\s*\(function\s*\(/);
    expect(script.trim().endsWith("return __result;")).toBe(true);
  });

  it("is deterministic - the same operation always produces byte-identical JSX", () => {
    expect(buildOperationScript(2, "!Render", op())).toBe(buildOperationScript(2, "!Render", op()));
  });

  /**
   * Real execution of the geometry algorithm (via the same
   * runFixedScriptWithoutNativeJson harness every other script in this
   * file uses to prove real behavior, not merely source text) against a
   * fake 1080x1920 source composition with one full-frame BACKGROUND layer
   * and one small, centered FOREGROUND layer (a stand-in for something
   * like a logo) - proves the actual numeric output of the deterministic
   * rule, not just that it exists in the script's own text.
   */
  const HORIZONTAL_APP_SETUP = `
    function CompItem() {}

    function makeLayer(opts) {
      var l = {};
      l.name = opts.name;
      l.enabled = opts.enabled !== undefined ? opts.enabled : true;
      l.hasVideo = opts.hasVideo !== undefined ? opts.hasVideo : true;
      l.threeDLayer = !!opts.threeDLayer;
      l.parent = opts.parent || null;
      var __posKeys = opts.positionKeys || 0;
      var __scaleKeys = opts.scaleKeys || 0;
      l.transform = {
        anchorPoint: { value: opts.anchor },
        position: { value: opts.position, numKeys: __posKeys, setValue: function (v) { l.transform.position.value = v; } },
        scale: { value: opts.scale, numKeys: __scaleKeys, setValue: function (v) { l.transform.scale.value = v; } }
      };
      l.sourceRectAtTime = function () {
        if (opts.srcRectThrows) { throw new Error("no bounds"); }
        return opts.srcRect;
      };
      return l;
    }

    var __bgLayer = makeLayer({ name: "Background", anchor: [0, 0], position: [0, 0], scale: [100, 100], srcRect: { left: 0, top: 0, width: 1080, height: 1920 } });
    var __logoLayer = makeLayer({ name: "Logo", anchor: [50, 50], position: [540, 960], scale: [100, 100], srcRect: { left: 0, top: 0, width: 100, height: 100 } });

    var __origComp = new CompItem();
    __origComp.name = ${JSON.stringify("!Render")};
    __origComp.width = 1080;
    __origComp.height = 1920;
    __origComp.duration = 45;
    __origComp.frameRate = 30;

    var __theDuplicate = new CompItem();
    __theDuplicate.name = "unnamed duplicate stub";
    var __newCompLayers = [__bgLayer, __logoLayer];
    __theDuplicate.numLayers = __newCompLayers.length;
    __theDuplicate.layer = function (i) { return __newCompLayers[i - 1]; };
    __origComp.duplicate = function () { return __theDuplicate; };

    var __allItems = [__origComp, __theDuplicate];
    var app = {
      beginUndoGroup: function () {},
      endUndoGroup: function () {},
      project: {
        numItems: __allItems.length,
        item: function (i) { return __allItems[i - 1]; }
      }
    };
  `;

  it("a full-frame BACKGROUND layer is rescaled (non-uniformly) to exactly fill the new 1920x1080 canvas edge-to-edge", () => {
    const script = buildOperationScript(1, "!Render", op());
    const resultText = runFixedScriptWithoutNativeJson(script, HORIZONTAL_APP_SETUP);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(true);
    // scaleX = 100 * (1920/1080), scaleY = 100 * (1080/1920), position stays at the frame's own (0,0) corner.
    const context = vm.createContext({});
    vm.runInContext("JSON = undefined;", context);
    vm.runInContext(HORIZONTAL_APP_SETUP, context);
    vm.runInContext(`(new Function("args", ${JSON.stringify(script)}))()`, context);
    const bgTransform = vm.runInContext("__bgLayer.transform", context) as { position: { value: number[] }; scale: { value: number[] } };
    expect(bgTransform.scale.value[0]).toBeCloseTo((1920 / 1080) * 100, 6);
    expect(bgTransform.scale.value[1]).toBeCloseTo((1080 / 1920) * 100, 6);
    expect(bgTransform.position.value[0]).toBeCloseTo(0, 6);
    expect(bgTransform.position.value[1]).toBeCloseTo(0, 6);
  });

  it("a small, centered FOREGROUND layer keeps its own real pixel scale and is repositioned to the SAME proportional center in the new canvas", () => {
    const script = buildOperationScript(1, "!Render", op());
    const context = vm.createContext({});
    vm.runInContext("JSON = undefined;", context);
    vm.runInContext(HORIZONTAL_APP_SETUP, context);
    vm.runInContext(`(new Function("args", ${JSON.stringify(script)}))()`, context);
    const logoTransform = vm.runInContext("__logoLayer.transform", context) as { position: { value: number[] }; scale: { value: number[] } };
    // Was centered at (540,960) in the 1080x1920 source (exact center) - must stay exactly centered in the new 1920x1080 canvas: (960,540).
    expect(logoTransform.scale.value).toEqual([100, 100]);
    expect(logoTransform.position.value[0]).toBeCloseTo(960, 6);
    expect(logoTransform.position.value[1]).toBeCloseTo(540, 6);
  });

  it("real end-to-end refusal: a parented layer stops the whole operation and reports a typed failureReason, never a partial/silent result", () => {
    const parentedSetup = `
      function CompItem() {}
      function makeLayer(opts) {
        var l = {};
        l.name = opts.name;
        l.enabled = true;
        l.hasVideo = true;
        l.threeDLayer = false;
        l.parent = opts.parent || null;
        l.transform = {
          anchorPoint: { value: [0, 0] },
          position: { value: [0, 0], numKeys: 0, setValue: function () {} },
          scale: { value: [100, 100], numKeys: 0, setValue: function () {} }
        };
        l.sourceRectAtTime = function () { return { left: 0, top: 0, width: 100, height: 100 }; };
        return l;
      }
      var __parentLayer = makeLayer({ name: "Parent" });
      var __childLayer = makeLayer({ name: "Child", parent: __parentLayer });

      var __origComp = new CompItem();
      __origComp.name = ${JSON.stringify("!Render")};
      __origComp.width = 1080;
      __origComp.height = 1920;

      var __theDuplicate = new CompItem();
      __theDuplicate.name = "unnamed duplicate stub";
      var __removed = false;
      __theDuplicate.remove = function () { __removed = true; };
      var __newCompLayers = [__parentLayer, __childLayer];
      __theDuplicate.numLayers = __newCompLayers.length;
      __theDuplicate.layer = function (i) { return __newCompLayers[i - 1]; };
      __origComp.duplicate = function () { return __theDuplicate; };

      var __allItems = [__origComp, __theDuplicate];
      var app = {
        beginUndoGroup: function () {},
        endUndoGroup: function () {},
        project: { numItems: __allItems.length, item: function (i) { return __allItems[i - 1]; } }
      };
    `;
    const script = buildOperationScript(1, "!Render", op());
    const resultText = runFixedScriptWithoutNativeJson(script, parentedSetup);
    const result = JSON.parse(resultText);
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("parented to another layer");
  });
});

/**
 * Modal-safe target-project open (2026-09-03, real production incident): a
 * real client attempt showed AE presenting a native "19 files are missing
 * since you last saved this project" modal while opening the target
 * project - this leaves AE technically ONLINE (the MCP bridge process is
 * alive) while blocking all further scripting/MCP calls, surfacing as
 * repeated -32001 timeouts. `buildOpenProjectScript` now scopes
 * `app.beginSuppressDialogs()`/`app.endSuppressDialogs(false)` tightly
 * around ONLY the `app.open()` call itself.
 *
 * Runs the REAL built script (via runFixedScriptWithoutNativeJson, the
 * same harness every other script in this file uses) against a fake
 * `app`/`File` object model that records every AE API call in order, so
 * these tests prove real *behavior* (call ordering, suppression always
 * released, no save ever attempted) rather than only asserting on the
 * script's source text.
 */
describe("buildOpenProjectScript (modal-safe target project open, 2026-09-03)", () => {
  const REQUESTED_PATH = "C:\\DYO-Agent\\copy\\White App Promo.aep";

  /**
   * Fake ExtendScript-like `app`/`File` object model, constructed as
   * source text (see runFixedScriptWithoutNativeJson's own doc comment on
   * why) so it runs natively inside the same vm realm as the script under
   * test. Every `app.*` call the script under test can make is recorded,
   * in order, into `__calls` - the one thing these tests assert on to
   * prove real suppression/open/save behavior, not just the script's own
   * source text. `openBehavior` "success" opens `openedPath` (defaults to
   * REQUESTED_PATH - the honest, no-mismatch case); "returns-false"
   * simulates `app.open()` returning without opening anything; "throws"
   * simulates `app.open()` itself throwing (e.g. a genuinely unexpected
   * AE-side error, distinct from a suppressed dialog).
   */
  function buildFakeAppSetup(
    options: { openBehavior?: "success" | "returns-false" | "throws"; openedPath?: string } = {}
  ): string {
    const openBehavior = options.openBehavior ?? "success";
    const openedPath = options.openedPath ?? REQUESTED_PATH;
    return `
      function File(path) { this.fsName = path; }
      var __calls = [];
      var app = {
        beginUndoGroup: function () { __calls.push("beginUndoGroup"); },
        endUndoGroup: function () { __calls.push("endUndoGroup"); },
        beginSuppressDialogs: function () { __calls.push("beginSuppressDialogs"); },
        endSuppressDialogs: function (alert) { __calls.push("endSuppressDialogs:" + alert); },
        project: null,
        open: function (file) {
          __calls.push("open:" + file.fsName);
          ${
            openBehavior === "throws"
              ? `throw new Error("simulated AE-side open failure");`
              : openBehavior === "returns-false"
                ? `return false;`
                : `
          app.project = {
            file: { fsName: ${JSON.stringify(openedPath)} },
            name: "fixture",
            save: function () { __calls.push("SAVE_CALLED"); }
          };
          return true;`
          }
        }
      };
    `;
  }

  /** Runs the script and returns both its own JSON result AND the ordered call log - see buildFakeAppSetup's own doc comment. */
  function runOpenScript(setup: string): { result: { ok: boolean; failureReason?: string; resultingValue?: { openedPath: string | null; openedName: string | null } }; calls: string[] } {
    const context = vm.createContext({});
    vm.runInContext("JSON = undefined;", context);
    vm.runInContext(setup, context);
    const raw = vm.runInContext(`(new Function("args", ${JSON.stringify(buildOpenProjectScript(REQUESTED_PATH))}))()`, context) as string;
    const calls = vm.runInContext("__calls", context) as string[];
    return { result: JSON.parse(raw), calls };
  }

  it("suppresses dialogs (including an expected missing-footage warning) tightly around ONLY app.open() - no manual client interaction is required or possible", () => {
    const { result, calls } = runOpenScript(buildFakeAppSetup());
    expect(result.ok).toBe(true);
    expect(result.resultingValue?.openedPath).toBe(REQUESTED_PATH);
    // Dialog suppression is active for the entire, and only the, duration
    // of the open call - begun immediately before it, ended immediately
    // after - so ANY dialog AE would show while opening (a missing-footage
    // warning included) is suppressed by construction; there is no window
    // where a dialog could appear and block, and nothing left for a human
    // to click through.
    expect(calls).toEqual(["beginUndoGroup", "beginSuppressDialogs", `open:${REQUESTED_PATH}`, "endSuppressDialogs:false", "endUndoGroup"]);
  });

  it("dialog suppression always ends after a successful open", () => {
    const { calls } = runOpenScript(buildFakeAppSetup());
    expect(calls.filter((c) => c.indexOf("endSuppressDialogs") === 0)).toEqual(["endSuppressDialogs:false"]);
    // Suppression is released immediately, before endUndoGroup/return -
    // never left engaged for the rest of the script or beyond it.
    expect(calls.indexOf("endSuppressDialogs:false")).toBeLessThan(calls.indexOf("endUndoGroup"));
  });

  it("dialog suppression always ends even when app.open() itself throws", () => {
    const { result, calls } = runOpenScript(buildFakeAppSetup({ openBehavior: "throws" }));
    // The real deterministic failure is never hidden by suppression - it
    // is still reported exactly like any other unexpected error.
    expect(result.ok).toBe(false);
    expect(result.failureReason).toMatch(/simulated AE-side open failure/);
    // The inner try/finally around app.open() still ran its finally
    // clause even though app.open() threw - suppression is never left
    // engaged after an exception.
    expect(calls).toContain("endSuppressDialogs:false");
    expect(calls.indexOf("beginSuppressDialogs")).toBeLessThan(calls.indexOf("endSuppressDialogs:false"));
    expect(calls).toContain("endUndoGroup");
  });

  it("reports app.open() returning false as a clear, typed failure - and never touches save", () => {
    const { result, calls } = runOpenScript(buildFakeAppSetup({ openBehavior: "returns-false" }));
    expect(result.ok).toBe(false);
    expect(result.failureReason).toMatch(/did not return an opened project/);
    expect(calls).toContain("endSuppressDialogs:false");
    expect(calls).not.toContain("SAVE_CALLED");
  });

  it("no save operation is ever executed, on either a successful or a failed open", () => {
    const success = runOpenScript(buildFakeAppSetup());
    expect(success.calls).not.toContain("SAVE_CALLED");
    const failure = runOpenScript(buildFakeAppSetup({ openBehavior: "returns-false" }));
    expect(failure.calls).not.toContain("SAVE_CALLED");
    // Static confirmation too - the script text itself never references save.
    const script = buildOpenProjectScript(REQUESTED_PATH);
    expect(script).not.toContain(".save(");
  });

  it("when AE actually opens a different project than requested, the script still honestly reports the REAL opened path - never the requested path blindly (the caller, heroic-swan-template-inspector.ts, is the layer that fails this closed - see its own P0 regression tests)", () => {
    const { result } = runOpenScript(buildFakeAppSetup({ openedPath: "C:\\DYO-Agent\\some-other-project.aep" }));
    expect(result.ok).toBe(true);
    expect(result.resultingValue?.openedPath).toBe("C:\\DYO-Agent\\some-other-project.aep");
    expect(result.resultingValue?.openedPath).not.toBe(REQUESTED_PATH);
  });

  it("scopes dialog suppression in its OWN try/finally, nested inside (and narrower than) the script's outer beginUndoGroup/try/finally", () => {
    const script = buildOpenProjectScript(REQUESTED_PATH);
    expect(script).toContain("app.beginSuppressDialogs();");
    expect(script).toContain("app.endSuppressDialogs(false);");
    // Never suppressed with the "show a summary alert afterward" flag -
    // that would just reintroduce a blocking modal.
    expect(script).not.toContain("app.endSuppressDialogs(true)");
    const beginIndex = script.indexOf("app.beginSuppressDialogs();");
    const openIndex = script.indexOf("__opened = app.open(");
    const innerFinallyIndex = script.indexOf("app.endSuppressDialogs(false);");
    expect(beginIndex).toBeLessThan(openIndex);
    expect(openIndex).toBeLessThan(innerFinallyIndex);
    // Suppression's own try/finally is nested strictly inside the outer
    // beginUndoGroup try block - never engaged before beginUndoGroup, and
    // the outer finally (endUndoGroup) always runs after it too.
    const outerTryIndex = script.indexOf("try {");
    const outerFinallyIndex = script.lastIndexOf("} finally {");
    expect(outerTryIndex).toBeLessThan(beginIndex);
    expect(innerFinallyIndex).toBeLessThan(outerFinallyIndex);
  });

  it("is a bare function BODY wrapped in beginUndoGroup/try/finally/endUndoGroup like every other script, and is deterministic", () => {
    const script = buildOpenProjectScript(REQUESTED_PATH);
    expect(script).not.toMatch(/^\s*\(function\s*\(/);
    expect(script.trim().endsWith("return __result;")).toBe(true);
    expect(script).toContain("app.beginUndoGroup(");
    expect(script).toContain("app.endUndoGroup();");
    expect(buildOpenProjectScript(REQUESTED_PATH)).toBe(buildOpenProjectScript(REQUESTED_PATH));
  });
});

describe("no other allowlisted script can leave AE blocked by an unsuppressed dialog (2026-09-03 modal-safety invariant)", () => {
  it("app.open() is called from exactly two reviewed places in this file - buildOpenProjectScript and buildReopenProjectFromDiskScript (real 2026-09-14) - each inside beginSuppressDialogs/endSuppressDialogs, never from any other script builder", () => {
    const sourceUrl = new URL("../jsx-templates.ts", import.meta.url);
    const source = readFileSync(fileURLToPath(sourceUrl), "utf8");
    // Matches only a REAL call with an argument (app.open(<something>)) -
    // deliberately excludes the zero-arg `app.open()` form, which only
    // ever appears in doc-comment prose and in this script's own
    // failureReason string, never as an actual call.
    const matches = source.match(/\bapp\.open\([^)]/g) ?? [];
    expect(matches).toHaveLength(2);
    for (const script of [buildOpenProjectScript("C:\\a\\b.aep"), buildReopenProjectFromDiskScript("C:\\a\\b.aep")]) {
      const openAt = script.indexOf("app.open(");
      expect(openAt).toBeGreaterThan(-1);
      expect(script.lastIndexOf("app.beginSuppressDialogs()", openAt)).toBeGreaterThan(-1);
      expect(script.indexOf("app.endSuppressDialogs(", openAt)).toBeGreaterThan(openAt);
    }
  });
});


describe("buildInspectTextLayerClippingScript (real 2026-09-17: a proven-correct Hebrew line rendered partly clipped)", () => {
  // Every setter throws: the script must only ever read.
  const CLIPPING_APP_SETUP = (options: { withTrackMatteLayerApi?: boolean; layerCount?: number } = {}) => `
    function CompItem() {}
    var MaskMode = { NONE: 6812, ADD: 6813, SUBTRACT: 6814, INTERSECT: 6815, LIGHTEN: 6816, DARKEN: 6817, DIFFERENCE: 6818 };
    var TrackMatteType = { NO_TRACK_MATTE: 5012, ALPHA: 5013, ALPHA_INVERTED: 5014, LUMA: 5015, LUMA_INVERTED: 5016 };
    var ParagraphJustification = { LEFT_JUSTIFY: 7413, RIGHT_JUSTIFY: 7414, CENTER_JUSTIFY: 7415, FULL_JUSTIFY_LASTLINE_LEFT: 7416, FULL_JUSTIFY_LASTLINE_RIGHT: 7417, FULL_JUSTIFY_LASTLINE_CENTER: 7418, FULL_JUSTIFY_LASTLINE_FULL: 7419 };
    var __writes = [];
    function prop(valueAt, numKeys) {
      return { numKeys: numKeys || 0, valueAtTime: function (t) { return typeof valueAt === "function" ? valueAt(t) : valueAt; }, setValue: function () { __writes.push("setValue"); throw new Error("READ-ONLY VIOLATION"); } };
    }
    function group(items) { return { numProperties: items.length, property: function (i) { return items[i - 1]; } }; }
    function named(name, matchName, children) {
      var g = { name: name, matchName: matchName, enabled: true };
      g.property = function (n) { return children[n] || null; };
      return g;
    }

    var __mask = {
      name: "Reveal", maskMode: MaskMode.ADD, inverted: false,
      property: function (n) {
        if (n === "ADBE Mask Shape") { return prop(function (t) { return { vertices: [[400, -60], [900, -60], [900, 40], [400, 40]], closed: true }; }, 2); }
        if (n === "ADBE Mask Feather") { return prop([0, 0]); }
        if (n === "ADBE Mask Opacity") { return prop(100); }
        if (n === "ADBE Mask Offset") { return prop(0); }
        return null;
      }
    };
    var __selector = named("Range Selector 1", "ADBE Text Selector", {
      "ADBE Text Percent Start": prop(0), "ADBE Text Percent End": prop(100), "ADBE Text Percent Offset": prop(0)
    });
    var __animator = named("Animator 1", "ADBE Text Animator", {
      "ADBE Text Selectors": group([__selector]),
      "ADBE Text Animator Properties": group([{ name: "Position", matchName: "ADBE Text Position 3D", valueAtTime: function () { return [0, 0, 0]; } }])
    });
    var __doc = { text: "מבית DYO App", font: "TimesNewRomanPSMT", fontSize: 96, justification: ParagraphJustification.RIGHT_JUSTIFY, boxText: false };
    var __textProps = { "ADBE Text Document": prop(__doc), "ADBE Text Animators": group([__animator]) };

    var __matte = { index: 1, name: "Matte Solid", enabled: false, inPoint: 0, outPoint: 7.04, startTime: 0, threeDLayer: false, parent: null, isTrackMatte: true, hasTrackMatte: false, trackMatteType: TrackMatteType.NO_TRACK_MATTE };
    __matte.transform = { anchorPoint: prop([0, 0]), position: prop([960, 540]), scale: prop([100, 100]), rotation: prop(0), opacity: prop(100) };
    __matte.sourceRectAtTime = function () { return { left: 0, top: 0, width: 1920, height: 1080 }; };
    __matte.property = function (n) { return n === "ADBE Mask Parade" ? group([]) : n === "ADBE Effect Parade" ? group([]) : null; };

    var __text = { index: 2, name: "Text 1", enabled: true, inPoint: 0.4, outPoint: 60.4, startTime: 0, threeDLayer: false, parent: null, isTrackMatte: false, hasTrackMatte: true, trackMatteType: TrackMatteType.ALPHA };
    ${options.withTrackMatteLayerApi === false ? "Object.defineProperty(__text, 'trackMatteLayer', { get: function () { throw new Error('not supported'); } });" : "__text.trackMatteLayer = __matte;"}
    __text.transform = { anchorPoint: prop([0, 0]), position: prop([1480, 520]), scale: prop([100, 100]), rotation: prop(0), opacity: prop(100) };
    __text.sourceRectAtTime = function (t) { return { left: -610, top: -70, width: 610, height: 90 }; };
    __text.property = function (n) {
      if (n === "ADBE Mask Parade") { return group([__mask]); }
      if (n === "ADBE Effect Parade") { return group([{ name: "Linear Wipe", matchName: "ADBE Linear Wipe", enabled: true }]); }
      if (n === "ADBE Text Properties") { return { property: function (inner) { return __textProps[inner] || null; } }; }
      return null;
    };

    var __comp = new CompItem();
    __comp.name = "Smartphone_05"; __comp.width = 1920; __comp.height = 1080; __comp.duration = 7.04;
    __comp.numLayers = ${options.layerCount ?? 2};
    __comp.layer = function (i) { return i === 1 ? __matte : i === 2 ? __text : null; };
    var app = { beginUndoGroup: function () {}, endUndoGroup: function () {}, project: { item: function (i) { return i === 45 ? __comp : null; } } };
  `;

  function run(script: string, setup: string) {
    const context = vm.createContext({});
    vm.runInContext("JSON = undefined;", context);
    vm.runInContext(setup, context);
    const resultText = vm.runInContext(`(new Function("args", ${JSON.stringify(script)}))()`, context) as string;
    const writes = vm.runInContext("__writes", context) as string[];
    return { result: JSON.parse(resultText), writes };
  }

  it("describes masks, track matte, text box/justification, rendered rect, text animators and effects of one layer at one time - and never writes", () => {
    const { result, writes } = run(buildInspectTextLayerClippingScript(45, "Smartphone_05", 2, 21 - 16.04), CLIPPING_APP_SETUP());
    expect(writes).toEqual([]);
    expect(result.ok).toBe(true);
    const facts = result.facts;
    expect(facts.timeSeconds).toBeCloseTo(4.96, 9);
    expect(facts.composition).toEqual({ name: "Smartphone_05", width: 1920, height: 1080, durationSeconds: 7.04 });
    expect(facts.layer).toMatchObject({
      layerIndex: 2, layerName: "Text 1", enabled: true, hasTrackMatte: true, trackMatteType: "ALPHA",
      trackMatteLayer: { layerIndex: 1, layerName: "Matte Solid" },
      rectAtTime: { left: -610, top: -70, width: 610, height: 90 },
      transformAtTime: { position: [1480, 520], scale: [100, 100], rotation: 0, opacity: 100 },
      effects: [{ name: "Linear Wipe", matchName: "ADBE Linear Wipe", enabled: true }]
    });
    expect(facts.layer.masks).toEqual([
      { index: 1, name: "Reveal", mode: "ADD", inverted: false, shapeAnimated: true, boundsAtTime: { left: 400, top: -60, right: 900, bottom: 40, vertexCount: 4, closed: true }, featherAtTime: [0, 0], opacityAtTime: 100, expansionAtTime: 0 }
    ]);
    expect(facts.text).toMatchObject({ textLength: 12, font: "TimesNewRomanPSMT", fontSize: 96, justification: "RIGHT_JUSTIFY", boxText: false, boxTextSize: null });
    expect(facts.text.animators).toEqual([
      { name: "Animator 1", enabled: true, selectors: [{ name: "Range Selector 1", matchName: "ADBE Text Selector", startAtTime: 0, endAtTime: 100, offsetAtTime: 0 }], properties: [{ name: "Position", matchName: "ADBE Text Position 3D", valueAtTime: [0, 0, 0] }] }
    ]);
    expect(facts.matteLayer).toMatchObject({ layerIndex: 1, layerName: "Matte Solid", isTrackMatte: true, enabled: false });
  });

  it("an After Effects without trackMatteLayer reports it as null and still describes the classic matte (the layer above)", () => {
    const { result, writes } = run(buildInspectTextLayerClippingScript(45, "Smartphone_05", 2, 4.96), CLIPPING_APP_SETUP({ withTrackMatteLayerApi: false }));
    expect(writes).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.facts.layer.trackMatteLayer).toBeNull();
    expect(result.facts.matteLayer).toMatchObject({ layerIndex: 1, layerName: "Matte Solid" });
  });

  it("refuses the wrong composition and an out-of-range layer instead of describing something else", () => {
    const wrongComp = run(buildInspectTextLayerClippingScript(45, "Smartphone_04", 2, 1), CLIPPING_APP_SETUP());
    expect(wrongComp.result.ok).toBe(false);
    expect(wrongComp.result.failureReason).toMatch(/expected "Smartphone_04"/);
    const outOfRange = run(buildInspectTextLayerClippingScript(45, "Smartphone_05", 9, 1), CLIPPING_APP_SETUP());
    expect(outOfRange.result.ok).toBe(false);
    expect(outOfRange.result.failureReason).toMatch(/layer index 9 is outside composition "Smartphone_05" \(2 layers\)/);
  });
});
