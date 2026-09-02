import vm from "node:vm";
import { describe, expect, it } from "vitest";
import type { SceneEditOperation } from "@dyo/schemas";
import {
  buildOperationScript,
  buildSaveProjectScript,
  buildInspectRenderCapabilitiesScript,
  buildInspectCompositionPrecompsScript
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
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 3, text: "Hello" };
    const a = buildOperationScript(2, COMP_NAME, op);
    const b = buildOperationScript(2, COMP_NAME, op);
    expect(a).toBe(b);
  });

  it("is a bare function BODY, never a self-invoking (function(){...})() expression - regression test for the real ae_run_jsx contract (new Function('args', code))", () => {
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "x" };
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
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "x" },
      { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, assetPath: "/tmp/a.png" },
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
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: malicious };
    const script = buildOperationScript(0, COMP_NAME, op);
    // The malicious payload must appear only inside a properly escaped
    // JSON string literal (backslash-escaped quotes), never as a bare
    // unescaped `app.quit()` call sitting outside any string.
    expect(script).not.toMatch(/[^\\]"; app\.quit\(\); var x = "[^\\]/);
    expect(script).toContain(JSON.stringify(malicious));
  });

  it("never breaks out via a backslash/newline/unicode-heavy text value", () => {
    const nasty = 'line1\nline2\\backslash  "quote"';
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: nasty };
    // Must not throw, and must produce valid embeddable JSON for the value.
    const script = buildOperationScript(0, COMP_NAME, op);
    expect(script).toContain(JSON.stringify(nasty));
  });

  it("SET_TEXT preserves style by mutating only sourceText.value.text, never replacing the whole TextDocument", () => {
    const op: SceneEditOperation = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "שלום" };
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
    const op: SceneEditOperation = { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 4, assetPath: "/safe/local/clip.mp4" };
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
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "x" },
      { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, assetPath: "/a.png" },
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
    { name: "SET_TEXT", script: buildOperationScript(1, COMP_NAME, { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "x" }) },
    { name: "MAP_FOOTAGE", script: buildOperationScript(1, COMP_NAME, { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, assetPath: "/tmp/a.png" }) },
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
    { name: "INSPECT_COMPOSITION_PRECOMPS", script: buildInspectCompositionPrecompsScript(1, COMP_NAME) }
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
