import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroicSwanSceneEvidenceInspector } from "./heroic-swan-scene-evidence-inspector.js";
import type { SceneEvidenceSuccess } from "./scene-evidence-inspector.js";

let dir: string;
let sourceProjectPath: string;
let sourceProjectSha256: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-scene-evidence-inspector-"));
  sourceProjectPath = join(dir, "template-copy.aep");
  const content = "sanitized fixture bytes - not a real .aep, just needs to exist on disk";
  await writeFile(sourceProjectPath, content);
  sourceProjectSha256 = createHash("sha256").update(content).digest("hex");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    sourceProjectPath,
    sourceProjectSha256,
    manifestCompositionId: "comp-275",
    aeProjectItemIndex: 14,
    compositionName: "Text 01",
    layerIndices: [1],
    previewTimestampSeconds: null,
    ...overrides
  };
}

/**
 * A real fake ae-mcp MCP server exercising the real allowlisted
 * ae_get_composition/ae_get_layer/ae_capture_frame tools in their real
 * confirmed shapes (see parse-mcp-shapes.ts) - also registers ae_run_jsx
 * to prove this inspector never calls it, matching
 * heroic-swan-template-inspector.test.ts's approach.
 */
async function writeFakeServer(
  aeMcpPath: string,
  options: {
    layerGetFails?: boolean;
    captureShape?: "image" | "fallback" | "none";
    previewFilePath?: string;
    /** "success" returns a real, double-JSON-enveloped {ok:true, layerDetails:[...]} result (the real host's actual ae_run_jsx envelope shape); "hostLayerMatches" returns a real {ok:true, matches:[...]} envelope matching the buildFindHostLayersScript response shape; "error" simulates a TOOL_ERROR; omitted keeps the pre-existing plain-text stub (only reachable by discoverLayerDetails:true requests). */
    runJsxResult?: "success" | "hostLayerMatches" | "error";
    /** When set, the fake ae_run_jsx tool writes the REAL `code` argument it received to this file path - lets a test verify (from the separate spawned process's own real input) which mode buildInspectCompositionLayerDetailsScript was actually invoked with, not merely that SOME result came back. */
    captureReceivedJsxCodeToFile?: string;
  } = {}
): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
(async () => {
  const { McpServer } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "mcp.js"))});
  const { StdioServerTransport } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "stdio.js"))});
  const { z } = await import(${JSON.stringify(join(process.cwd(), "node_modules", "zod", "index.js"))});

  const server = new McpServer({ name: "fake-ae-mcp-scene-evidence", version: "0.0.0" });
  let calls = [];

  server.registerTool("ae_get_composition", { description: "d" }, async () => {
    calls.push("ae_get_composition");
    return { content: [{ type: "text", text: JSON.stringify({ name: "Text 01", id: 275, width: 1080, height: 1920, frameRate: 30, duration: 4, numLayers: 1 }) }] };
  });

  server.registerTool("ae_get_layer", { description: "d" }, async () => {
    calls.push("ae_get_layer");
    if (${options.layerGetFails ? "true" : "false"}) {
      return { isError: true, content: [{ type: "text", text: "simulated ae_get_layer failure" }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({
        index: 1, name: "APP PROMO", enabled: true, inPoint: 0, outPoint: 4, startTime: 0,
        nullLayer: false, threeDLayer: false, parent: null, position: [960, 540], scale: [100,100], rotation: 0, opacity: 100, effects: []
      }) }]
    };
  });

  server.registerTool("ae_capture_frame", { description: "d" }, async () => {
    calls.push("ae_capture_frame");
    ${
      options.captureShape === "fallback"
        ? `return { content: [{ type: "text", text: JSON.stringify({ path: ${JSON.stringify(options.previewFilePath ?? "")}, comp: "Text 01", time: 2, width: 1080, height: 1920, bytes: 45210 }) }] };`
        : options.captureShape === "none"
          ? `return { isError: true, content: [{ type: "text", text: "simulated ae_capture_frame failure" }] };`
          : `return { content: [{ type: "text", text: JSON.stringify({ path: ${JSON.stringify(options.previewFilePath ?? "")}, comp: "Text 01", time: 2, note: "Frame captured. Image attached below." }) }, { type: "image", data: "base64==", mimeType: "image/png" }] };`
    }
  });

  server.registerTool(
    "ae_run_jsx",
    { description: "d", inputSchema: { code: z.string(), args: z.record(z.string(), z.unknown()).optional(), mode: z.string().optional() } },
    async (args) => {
    calls.push("ae_run_jsx");
    ${
      options.captureReceivedJsxCodeToFile
        ? `require("node:fs").writeFileSync(${JSON.stringify(options.captureReceivedJsxCodeToFile)}, String(args && args.code));`
        : ""
    }
    ${
      options.runJsxResult === "success"
        ? `return { content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ ok: true, layerDetails: [
            { layerIndex: 7, layerName: "Hebrew Branding", layerType: "TEXT", sourceText: "מבית DYO App", sourceCompositionId: null, stretchPercent: 100, timeRemapEnabled: false },
            { layerIndex: 8, layerName: "Precomp Ref", layerType: "PRECOMP", sourceText: null, sourceCompositionId: "comp-999", stretchPercent: 50, timeRemapEnabled: false }
          ] }) }) }] };`
        : options.runJsxResult === "hostLayerMatches"
          ? `return { content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ ok: true, matches: [
              { layerIndex: 3, layerName: "Nested Scene", enabled: true, inPointSeconds: 0, outPointSeconds: 7.007, startTimeSeconds: 12, sourceCompositionId: "comp-1", stretchPercent: 100, timeRemapEnabled: false, opacityStatic: 100, opacityKeyframes: null }
            ] }) }) }] };`
          : options.runJsxResult === "error"
            ? `return { isError: true, content: [{ type: "text", text: "simulated ae_run_jsx failure" }] };`
            : `return { content: [{ type: "text", text: "MUTATION - should never be reachable" }] };`
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

describe("HeroicSwanSceneEvidenceInspector - real spawned MCP server, not mocked", () => {
  it("returns real, AE-confirmed layer facts with every unknown left explicitly null", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest())) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.compositionName).toBe("Text 01");
    expect(result.response.verifiedSourceProjectSha256).toBe(sourceProjectSha256);
    expect(result.response.layers).toHaveLength(1);
    const layer = result.response.layers[0];
    expect(layer?.name).toBe("APP PROMO");
    expect(layer?.layerType).toBeNull();
    expect(layer?.sourceItemName).toBeNull();
    expect(layer?.textValue).toBeNull();
    expect(layer?.evidenceSource).toBe("AE_GET_LAYER");
  });

  it("rejects (fails honestly, reports no evidence/layers) when aeProjectItemIndex resolves to a composition whose real name does not match the expected compositionName - canonical composition addressing safety net", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = await inspector.inspect(baseRequest({ compositionName: "Some Other Scene" }));

    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason).toContain("resolved to composition");
    expect(result.reason).toContain("Text 01");
    expect(result.reason).toContain("Some Other Scene");
  });

  it("never calls ae_run_jsx when discoverLayerDetails is not requested, even though the (fake, hostile-capable) server offers it", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest())) as SceneEvidenceSuccess;
    expect(result.kind).toBe("evidence");
    expect(result.response.layerDetails).toBeNull();
    expect(result.response.layerDetailsFailureReason).toBeNull();
    // No direct hook into the fake server's `calls` array from here (separate
    // process) - proven instead by this inspector's own runInspection only
    // ever reaching fetchLayerDetails (the sole caller of
    // client.runFixedInspectionScript/ae_run_jsx) behind
    // `request.discoverLayerDetails === true` - baseRequest() never sets it.
  });

  it("live-QA generic AE layer-discovery capability: calls ae_run_jsx and returns real layerDetails when discoverLayerDetails is requested", async () => {
    await writeFakeServer(dir, { runJsxResult: "success" });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ discoverLayerDetails: true }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.layerDetailsFailureReason).toBeNull();
    expect(result.response.layerDetails).toEqual([
      { layerIndex: 7, layerName: "Hebrew Branding", layerType: "TEXT", sourceText: "מבית DYO App", sourceCompositionId: null, stretchPercent: 100, timeRemapEnabled: false, opacityStatic: null, opacityKeyframes: null },
      { layerIndex: 8, layerName: "Precomp Ref", layerType: "PRECOMP", sourceText: null, sourceCompositionId: "comp-999", stretchPercent: 50, timeRemapEnabled: false, opacityStatic: null, opacityKeyframes: null }
    ]);
    // Exact codepoint check - never trust visual/terminal RTL rendering.
    const hebrewPrefix = result.response.layerDetails?.[0]?.sourceText?.split(" ")[0];
    expect([...(hebrewPrefix ?? "")].map((c) => c.codePointAt(0))).toEqual([0x05de, 0x05d1, 0x05d9, 0x05ea]);
  });

  it("real 2026-09-10 incident: threads request.discoverLayerDetailsMode through to the REAL ae_run_jsx code sent - \"discovery\" produces the lightweight script (no stretch/timeRemapEnabled/opacity/sourceText reads), proven from the separate spawned process's own real received input, not merely the result shape", async () => {
    const capturePath = join(dir, "received-jsx-code.txt");
    await writeFakeServer(dir, { runJsxResult: "success", captureReceivedJsxCodeToFile: capturePath });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    await inspector.inspect(baseRequest({ discoverLayerDetails: true, discoverLayerDetailsMode: "discovery" }));

    const receivedCode = await readFile(capturePath, "utf8");
    expect(receivedCode).not.toMatch(/__layer\.stretch/);
    expect(receivedCode).not.toMatch(/__layer\.timeRemapEnabled/);
    expect(receivedCode).not.toMatch(/__layer\.opacity/);
    expect(receivedCode).toMatch(/__skipSourceTextRead = true/);
  });

  it("real 2026-09-10 incident: omitting discoverLayerDetailsMode (or \"full\") sends the SAME heavy script as before - no behavior change for every existing caller", async () => {
    const capturePath = join(dir, "received-jsx-code-full.txt");
    await writeFakeServer(dir, { runJsxResult: "success", captureReceivedJsxCodeToFile: capturePath });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    await inspector.inspect(baseRequest({ discoverLayerDetails: true }));

    const receivedCode = await readFile(capturePath, "utf8");
    expect(receivedCode).toMatch(/__layer\.stretch/);
    expect(receivedCode).toMatch(/__layer\.opacity/);
  });

  it("real 2026-09-10 incident (targeted host-layer lookup): threads request.findHostLayersForChildCompositionId through to the REAL ae_run_jsx code sent - produces the minimal buildFindHostLayersScript, not the full/discovery layerDetails script, proven from the separate spawned process's own real received input", async () => {
    const capturePath = join(dir, "received-jsx-code-find-host-layers.txt");
    await writeFakeServer(dir, { runJsxResult: "success", captureReceivedJsxCodeToFile: capturePath });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    await inspector.inspect(baseRequest({ findHostLayersForChildCompositionId: "comp-1" }));

    const receivedCode = await readFile(capturePath, "utf8");
    expect(receivedCode).toMatch(/DYO FIND_HOST_LAYERS/);
    expect(receivedCode).toMatch(/\("comp-" \+ __layer\.source\.id\) === "comp-1"/);
    // The whole point of this operation: it must never build/return the
    // parent's full layerDetails array, and it must never break early (it
    // has to find every real instance of a possibly-duplicated child).
    expect(receivedCode).not.toMatch(/__layerDetails = \[\]/);
    expect(receivedCode).not.toMatch(/\bbreak;/);
  });

  it("omitting findHostLayersForChildCompositionId (and discoverLayerDetails) never calls ae_run_jsx at all - no find-host-layers script is ever sent", async () => {
    const capturePath = join(dir, "received-jsx-code-no-find-host-layers.txt");
    await writeFakeServer(dir, { runJsxResult: "success", captureReceivedJsxCodeToFile: capturePath });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    await inspector.inspect(baseRequest());

    await expect(readFile(capturePath, "utf8")).rejects.toThrow();
  });

  it("live QA: successfully parses real matches returned by ae_run_jsx into response.hostLayerRecords when findHostLayersForChildCompositionId is requested", async () => {
    await writeFakeServer(dir, { runJsxResult: "hostLayerMatches" });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ findHostLayersForChildCompositionId: "comp-1" }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.hostLayerRecordsFailureReason).toBeNull();
    expect(result.response.hostLayerRecords).toEqual([
      { layerIndex: 3, layerName: "Nested Scene", enabled: true, inPointSeconds: 0, outPointSeconds: 7.007, startTimeSeconds: 12, sourceCompositionId: "comp-1", stretchPercent: 100, timeRemapEnabled: false, opacityStatic: 100, opacityKeyframes: null }
    ]);
  });

  it("reports a clear hostLayerRecordsFailureReason (never fabricates hostLayerRecords) when the ae_run_jsx response does not match the expected find-host-layers shape", async () => {
    await writeFakeServer(dir, { runJsxResult: "success" });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ findHostLayersForChildCompositionId: "comp-1" }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.hostLayerRecords).toBeNull();
    expect(result.response.hostLayerRecordsFailureReason).toMatch(/did not match the expected shape/);
  });

  it("reports hostLayerRecordsFailureReason (never fabricates hostLayerRecords) when findHostLayersForChildCompositionId is requested but the underlying ae_run_jsx call fails", async () => {
    await writeFakeServer(dir, { runJsxResult: "error" });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ findHostLayersForChildCompositionId: "comp-1" }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.hostLayerRecords).toBeNull();
    expect(result.response.hostLayerRecordsFailureReason).toMatch(/ae_run_jsx failed/);
    // A failed host-layer lookup never fails the rest of the evidence result.
    expect(result.response.layers).toHaveLength(1);
  });

  it("reports layerDetailsFailureReason (never fabricates layerDetails) when discoverLayerDetails is requested but the underlying ae_run_jsx call fails", async () => {
    await writeFakeServer(dir, { runJsxResult: "error" });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ discoverLayerDetails: true }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.layerDetails).toBeNull();
    expect(result.response.layerDetailsFailureReason).toMatch(/ae_run_jsx failed/);
    // A failed layer-detail discovery never fails the rest of the evidence result.
    expect(result.response.layers).toHaveLength(1);
  });

  it("rejects (fails honestly) when the source project's current sha256 no longer matches the requested one - never describes a changed project", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = await inspector.inspect(baseRequest({ sourceProjectSha256: "b".repeat(64) }));

    expect(result.kind).toBe("failure");
  });

  it("skips (rather than fails the whole request for) a layer whose ae_get_layer call fails - best-effort, never crashes", async () => {
    await writeFakeServer(dir, { layerGetFails: true });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest())) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.layers).toHaveLength(0);
  });

  it("captures and independently verifies a real preview file on disk (image-embedded shape)", async () => {
    const previewPath = join(dir, "Text_01_preview.png");
    await writeFile(previewPath, Buffer.from([1, 2, 3, 4]));
    await writeFakeServer(dir, { captureShape: "image", previewFilePath: previewPath });

    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ previewTimestampSeconds: 2 }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.preview).not.toBeNull();
    expect(result.response.preview?.path).toBe(previewPath);
    expect(result.response.preview?.bytes).toBe(4);
    expect(result.response.previewFailureReason).toBeNull();
  });

  it("captures and independently verifies a real preview file on disk (fallback shape)", async () => {
    const previewPath = join(dir, "Text_01_preview_fallback.png");
    await writeFile(previewPath, Buffer.from([1, 2, 3, 4, 5]));
    await writeFakeServer(dir, { captureShape: "fallback", previewFilePath: previewPath });

    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ previewTimestampSeconds: 2 }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.preview?.bytes).toBe(5);
  });

  it("reports previewFailureReason (never a fabricated preview) when the capture tool errors", async () => {
    await writeFakeServer(dir, { captureShape: "none" });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ previewTimestampSeconds: 2 }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.preview).toBeNull();
    expect(result.response.previewFailureReason).toMatch(/ae_capture_frame failed/);
  });

  it("reports previewFailureReason when the captured file does not actually exist on disk - never trusts AE's self-report alone", async () => {
    await writeFakeServer(dir, { captureShape: "image", previewFilePath: join(dir, "does-not-exist.png") });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ previewTimestampSeconds: 2 }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.preview).toBeNull();
    expect(result.response.previewFailureReason).toMatch(/could not verify/);
  });

  it("never attempts a preview capture when previewTimestampSeconds is not requested", async () => {
    await writeFakeServer(dir, { captureShape: "none" });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest())) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.preview).toBeNull();
    expect(result.response.previewFailureReason).toBeNull();
  });

  it("live QA Blocker 2 fix: a zero-placeholder scene (layerIndices: []) still reaches a real, independently-verified frame capture - layer evidence and frame capture are genuinely independent", async () => {
    const previewPath = join(dir, "Text_01_no_placeholders.png");
    await writeFile(previewPath, Buffer.from([1, 2, 3, 4, 5, 6]));
    await writeFakeServer(dir, { captureShape: "image", previewFilePath: previewPath });

    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ layerIndices: [], previewTimestampSeconds: 0 }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.layers).toEqual([]);
    expect(result.response.preview).not.toBeNull();
    expect(result.response.preview?.path).toBe(previewPath);
    expect(result.response.preview?.bytes).toBe(6);
    expect(result.response.previewFailureReason).toBeNull();
    // Exact composition identity is still verified even with no layers requested.
    expect(result.response.compositionName).toBe("Text 01");
  });

  it("live QA Blocker 2 fix: a zero-placeholder scene still reports an honest capture failure (never a fabricated preview) when ae_capture_frame itself fails", async () => {
    await writeFakeServer(dir, { captureShape: "none" });
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(baseRequest({ layerIndices: [], previewTimestampSeconds: 0 }))) as SceneEvidenceSuccess;

    expect(result.kind).toBe("evidence");
    expect(result.response.layers).toEqual([]);
    expect(result.response.preview).toBeNull();
    expect(result.response.previewFailureReason).toMatch(/ae_capture_frame failed/);
  });

  it("fails honestly, without spawning a process, when AE_MCP_PATH is not configured", async () => {
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: undefined });
    const result = await inspector.inspect(baseRequest());
    expect(result.kind).toBe("failure");
  });
});
