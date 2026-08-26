import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroicSwanTemplateInspector } from "./heroic-swan-template-inspector.js";
import type { ManifestInspectionResult, RawInspectionCapture } from "./template-inspector.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-heroicswan-inspector-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const request = { templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" };

/**
 * A real fake ae-mcp MCP server (built with the real SDK's own
 * McpServer/StdioServerTransport, spawned as a real child process over
 * real stdio - matching heroic-swan-mcp-client.test.ts's approach), so
 * these tests exercise HeroicSwanTemplateInspector's actual behavior, not
 * a mocked transport. Also registers ae_run_jsx and ae_get_composition -
 * proving the inspector never calls either, even though a hostile/buggy
 * server that offers them cannot make it do so.
 */
async function writeFakeServer(aeMcpPath: string, options: { oversized?: boolean; toolError?: boolean } = {}): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  const oversizedText = options.oversized ? "x".repeat(50_000) : "small";
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
(async () => {
  const { McpServer } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "mcp.js"))});
  const { StdioServerTransport } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "stdio.js"))});

  const args = process.argv.slice(2);
  if (args[0] !== "serve") {
    console.error("unexpected subcommand: " + args.join(" "));
    process.exit(99);
  }

  const server = new McpServer({ name: "fake-ae-mcp", version: "0.0.0" });
  let calls = [];

  server.registerTool("ae_health", { description: "d" }, async () => {
    calls.push("ae_health");
    return { content: [{ type: "text", text: JSON.stringify({ connected: true, weird_field: { nested: [1, 2, 3] } }) }] };
  });

  server.registerTool("ae_list_instances", { description: "d" }, async () => {
    calls.push("ae_list_instances");
    if (${options.toolError ? "true" : "false"}) {
      return { isError: true, content: [{ type: "text", text: "simulated failure" }] };
    }
    return { content: [{ type: "text", text: "not even json, just a plain string response" }] };
  });

  server.registerTool("ae_get_project_info", { description: "d" }, async () => {
    calls.push("ae_get_project_info");
    return { content: [{ type: "text", text: ${JSON.stringify(oversizedText)} }] };
  });

  server.registerTool("ae_list_compositions", { description: "d" }, async () => {
    calls.push("ae_list_compositions");
    return { content: [{ type: "text", text: JSON.stringify([{ some_unconfirmed_field: "value" }]) }] };
  });

  server.registerTool("ae_get_composition", { description: "d" }, async () => {
    calls.push("ae_get_composition");
    return { content: [{ type: "text", text: "should never be called this pass" }] };
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

describe("HeroicSwanTemplateInspector - real spawned MCP server, not mocked", () => {
  it("calls exactly the four zero-argument allowlisted tools, and captures their real raw content verbatim", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(request)) as RawInspectionCapture;

    expect(result.kind).toBe("raw_capture");
    const calledTools = result.toolCalls.map((c) => c.tool).sort();
    expect(calledTools).toEqual(["ae_get_project_info", "ae_health", "ae_list_compositions", "ae_list_instances"].sort());

    const health = result.toolCalls.find((c) => c.tool === "ae_health");
    expect(health?.ok).toBe(true);
    expect(health?.content).toEqual([
      { type: "text", text: JSON.stringify({ connected: true, weird_field: { nested: [1, 2, 3] } }) }
    ]);
  });

  it("never calls ae_run_jsx or ae_get_composition, even though the (fake, hostile-capable) server offers them", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(request)) as RawInspectionCapture;

    const calledTools = result.toolCalls.map((c) => c.tool);
    expect(calledTools).not.toContain("ae_run_jsx");
    expect(calledTools).not.toContain("ae_get_composition");
    expect(result.note).toMatch(/ae_get_composition/);
  });

  it("preserves a malformed/unexpected raw response verbatim - never guesses or reshapes it into assumed fields", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(request)) as RawInspectionCapture;

    // ae_list_instances deliberately returns a plain, non-JSON-object text
    // block in this fixture - the capture must hold it exactly as returned.
    const listInstances = result.toolCalls.find((c) => c.tool === "ae_list_instances");
    expect(listInstances?.ok).toBe(true);
    expect(listInstances?.content).toEqual([{ type: "text", text: "not even json, just a plain string response" }]);
  });

  it("reports a tool's isError as a typed safe failure, never throwing", async () => {
    await writeFakeServer(dir, { toolError: true });
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(request)) as RawInspectionCapture;

    const listInstances = result.toolCalls.find((c) => c.tool === "ae_list_instances");
    expect(listInstances?.ok).toBe(false);
    expect(listInstances?.error).toEqual({ code: "TOOL_ERROR", message: "simulated failure" });
    // The other three tools are unaffected by one tool's failure.
    expect(result.toolCalls).toHaveLength(4);
    expect(result.toolCalls.filter((c) => c.ok)).toHaveLength(3);
  });

  it("bounds an oversized real response instead of storing it unbounded", async () => {
    await writeFakeServer(dir, { oversized: true });
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(request)) as RawInspectionCapture;

    const projectInfo = result.toolCalls.find((c) => c.tool === "ae_get_project_info");
    expect(projectInfo?.ok).toBe(true);
    expect(projectInfo?.truncated).toBe(true);
    expect(typeof projectInfo?.originalContentLength).toBe("number");
    expect((projectInfo?.originalContentLength as number)).toBeGreaterThan(20_000);
    expect(typeof projectInfo?.content).toBe("string");
    expect((projectInfo?.content as string).length).toBeLessThanOrEqual(20_000);
  });

  it("reports a typed unavailable capture, without ever spawning a process, when AE_MCP_PATH is not configured", async () => {
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: undefined });
    const result = (await inspector.inspect(request)) as RawInspectionCapture;

    expect(result.kind).toBe("raw_capture");
    expect(result.toolCalls).toHaveLength(4);
    for (const call of result.toolCalls) {
      expect(call.ok).toBe(false);
      expect(call.error?.code).toBe("NOT_CONFIGURED");
    }
  });

  it("reports a typed TRANSPORT_ERROR capture for every planned tool when ae-mcp is not actually installed at the configured path", async () => {
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: join(dir, "does-not-exist") });
    const result = (await inspector.inspect(request)) as RawInspectionCapture;

    expect(result.toolCalls).toHaveLength(4);
    for (const call of result.toolCalls) {
      expect(call.ok).toBe(false);
      expect(call.error?.code).toBe("TRANSPORT_ERROR");
    }
  });
});

/**
 * A second real fake ae-mcp server whose four discovery tools return
 * SANITIZED data in the real, confirmed shapes (see parse-mcp-shapes.ts's
 * module doc comment for how each shape was confirmed) - no real client
 * project names/paths are used anywhere here. ae_get_composition
 * dispatches on the real confirmed `comp_index` argument, matching
 * upstream's `resolveComp()` (host-scripts/ae-mcp-methods.jsx).
 */
async function writeRealShapeFakeServer(aeMcpPath: string, options: { compGetFailsForIndex?: number } = {}): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
(async () => {
  const { McpServer } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "mcp.js"))});
  const { StdioServerTransport } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "stdio.js"))});
  const { z } = await import(${JSON.stringify(join(process.cwd(), "node_modules", "zod", "index.js"))});

  const server = new McpServer({ name: "fake-ae-mcp-real-shapes", version: "0.0.0" });

  const comps = [
    { index: 3, name: "Comp A", width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 2 },
    { index: 7, name: "Comp B", width: 1080, height: 1920, frameRate: 30, duration: 10, numLayers: 0 }
  ];

  server.registerTool("ae_health", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ connected: true, ae_running: true, health: { connected: true, aeVersion: "26.3x87" } }) }]
  }));

  server.registerTool("ae_list_instances", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ instances: [{ instanceId: "default", aeVersion: "26.3x87" }] }) }]
  }));

  server.registerTool("ae_get_project_info", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ name: "Untitled", path: null, bitsPerChannel: 8, numItems: 12, compositions: comps }) }]
  }));

  server.registerTool("ae_list_compositions", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify(comps) }]
  }));

  // Real confirmed upstream input contract (CompRef + response_format) -
  // see host-scripts/ae-mcp-methods.jsx / src/mcp/tools/index.ts fetched
  // directly from HeroicSwan/after-effects-mcp. A tool registered with no
  // inputSchema never receives its call arguments from the real SDK (only
  // the RequestHandlerExtra) - declaring this schema is what makes args
  // actually arrive at the handler below, exactly as it would for the real
  // upstream server.
  const compRefShape = {
    comp_name: z.string().optional(),
    comp_index: z.number().int().positive().optional(),
    response_format: z.enum(["concise", "detailed"]).optional().default("concise")
  };

  server.registerTool("ae_get_composition", { description: "d", inputSchema: compRefShape }, async (args) => {
    if (args.comp_index === ${JSON.stringify(options.compGetFailsForIndex ?? -1)}) {
      return { isError: true, content: [{ type: "text", text: "simulated ae_get_composition failure" }] };
    }
    if (args.comp_index === 3) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          name: "Comp A", id: 42, width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 2, bgColor: [0,0,0],
          layers: [
            { index: 1, name: "Text Layer", enabled: true, inPoint: 0, outPoint: 5, startTime: 0, nullLayer: false, threeDLayer: false, parent: null },
            { index: 2, name: "Null Anchor", enabled: true, inPoint: 0, outPoint: 5, startTime: 0, nullLayer: true, threeDLayer: false, parent: null }
          ]
        }) }]
      };
    }
    if (args.comp_index === 7) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          name: "Comp B", id: 99, width: 1080, height: 1920, frameRate: 30, duration: 10, numLayers: 0, bgColor: [0,0,0], layers: []
        }) }]
      };
    }
    return { isError: true, content: [{ type: "text", text: "unexpected comp_index in test fixture" }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

describe("HeroicSwanTemplateInspector - real confirmed shapes build a validated TemplateManifest", () => {
  it("builds a real, schema-valid TemplateManifest end to end, hashing the real source file", async () => {
    await writeRealShapeFakeServer(dir);
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    expect(result.kind).toBe("manifest");
    expect(result.diagnostics).toHaveLength(4);
    const manifest = result.response.manifest;
    expect(manifest.compositions).toHaveLength(2);
    expect(manifest.compositions.map((c) => c.name)).toEqual(["Comp A", "Comp B"]);
    expect(manifest.afterEffects.version).toBe("26.3x87");
    expect(manifest.sourceProject.path).toBe(sourceProjectPath);
    expect(manifest.sourceProject.sha256).toHaveLength(64);
    expect(result.response.summary.compositionCount).toBe(2);
  });

  it("excludes the null-object layer from placeholders (Comp A has 2 raw layers, 1 real placeholder)", async () => {
    await writeRealShapeFakeServer(dir);
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    const sceneA = result.response.manifest.scenes.find((s) => s.compositionId === "comp-42");
    expect(sceneA?.placeholders).toHaveLength(1);
    expect(sceneA?.placeholders[0]?.layerName).toBe("Text Layer");
  });

  it("marks every placeholder unknown (honest limitation - ae_get_composition's confirmed shape has no layer-type field) with real evidence reasons", async () => {
    await writeRealShapeFakeServer(dir);
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    const sceneA = result.response.manifest.scenes.find((s) => s.compositionId === "comp-42");
    expect(sceneA?.placeholders[0]?.placeholderType).toBe("unknown");
    expect(sceneA?.placeholders[0]?.evidence.source).toBe("unknown");
  });

  it("falls back to a raw capture (never fabricates sourceProject facts) when sourceProjectPath does not point to a real file", async () => {
    await writeRealShapeFakeServer(dir);
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });

    const result = (await inspector.inspect({
      templateId: "tmpl-1",
      sourceProjectPath: join(dir, "does-not-exist.aep")
    })) as RawInspectionCapture;

    expect(result.kind).toBe("raw_capture");
    expect(result.note).toMatch(/hash/i);
    // The four discovery calls still succeeded and are still captured -
    // only the manifest build was refused, not the whole inspection.
    expect(result.toolCalls).toHaveLength(4);
    expect(result.toolCalls.every((c) => c.ok)).toBe(true);
  });

  it("still builds a manifest when one composition's detail fetch fails, recording an honest unknownItems entry for it", async () => {
    await writeRealShapeFakeServer(dir, { compGetFailsForIndex: 3 });
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    expect(result.kind).toBe("manifest");
    const manifest = result.response.manifest;
    // Comp A's detail failed - it still appears at summary level, with no layers/placeholders.
    const sceneA = manifest.scenes.find((s) => s.compositionId === "idx-3");
    expect(sceneA?.placeholders).toEqual([]);
    expect(manifest.unknownItems.some((u) => u.context === "Comp A" && /did not return usable layer data/.test(u.reason))).toBe(
      true
    );
    // Comp B's detail succeeded independently of Comp A's failure.
    const sceneB = manifest.scenes.find((s) => s.compositionId === "comp-99");
    expect(sceneB).toBeDefined();
  });
});
