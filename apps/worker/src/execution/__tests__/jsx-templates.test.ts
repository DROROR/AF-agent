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
  buildOpenProjectScript
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
        project: { item: function (i) { return __itemsByIndex[i]; } }
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

  it("wrong composition/layer fails closed: a step's aeProjectItemIndex does not resolve to any composition at all", () => {
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
    expect(result.failureReason).toContain("did not resolve to a composition");
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
        project: { item: function (i) { return i === 1 ? __comp : null; } }
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
  it("app.open() is called from exactly one reviewed place in this file - buildOpenProjectScript's own suppressed call - never from any other script builder", () => {
    const sourceUrl = new URL("../jsx-templates.ts", import.meta.url);
    const source = readFileSync(fileURLToPath(sourceUrl), "utf8");
    // Matches only a REAL call with an argument (app.open(<something>)) -
    // deliberately excludes the zero-arg `app.open()` form, which only
    // ever appears in doc-comment prose and in this script's own
    // failureReason string, never as an actual call.
    const matches = source.match(/\bapp\.open\([^)]/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
