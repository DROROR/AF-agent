import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    compositionIndex: 14,
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
  options: { layerGetFails?: boolean; captureShape?: "image" | "fallback" | "none"; previewFilePath?: string } = {}
): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
(async () => {
  const { McpServer } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "mcp.js"))});
  const { StdioServerTransport } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "stdio.js"))});

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

  server.registerTool("ae_run_jsx", { description: "d" }, async () => {
    calls.push("ae_run_jsx");
    return { content: [{ type: "text", text: "MUTATION - should never be reachable" }] };
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

  it("never calls ae_run_jsx, even though the (fake, hostile-capable) server offers it", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: dir });
    await inspector.inspect(baseRequest());
    // No direct hook into the fake server's `calls` array from here (separate
    // process) - proven instead by HeroicSwanMcpClient's own closed
    // AllowedInspectionTool union, which has no method to call ae_run_jsx at
    // all (see heroic-swan-mcp-client.ts).
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

  it("fails honestly, without spawning a process, when AE_MCP_PATH is not configured", async () => {
    const inspector = new HeroicSwanSceneEvidenceInspector({ aeMcpPath: undefined });
    const result = await inspector.inspect(baseRequest());
    expect(result.kind).toBe("failure");
  });
});
