import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroicSwanTemplateInspector } from "./heroic-swan-template-inspector.js";
import type { ManifestInspectionResult, RawInspectionCapture } from "./template-inspector.js";
import { buildOpenProjectScript } from "../execution/jsx-templates.js";

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
 * proving the inspector never calls either in THIS raw-capture scenario
 * (ae_list_compositions here deliberately returns a malformed shape, so
 * the per-composition loop - the only place either is now ever called
 * from - is never reached; see writeRealShapeFakeServer below for the
 * success-path tests that DO exercise both).
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
  const { z } = await import(${JSON.stringify(join(process.cwd(), "node_modules", "zod", "index.js"))});

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

  server.registerTool(
    "ae_run_jsx",
    { description: "d", inputSchema: { code: z.string(), args: z.record(z.string(), z.unknown()).optional(), mode: z.string().optional() } },
    async (args) => {
    calls.push("ae_run_jsx");
    // P0 fix (2026-09-03): the open-project script is now called before
    // any other real inspection tool - generically detected here (rather
    // than per-test-customized) and always reports success, echoing back
    // whatever literal path buildOpenProjectScript embedded, so every
    // pre-existing scenario below still exercises exactly the same
    // downstream behavior it did before this fix - none of them are
    // testing open-project behavior specifically (see the dedicated
    // open/retry fake-server further down for tests that are).
    const openMatch = /new File\\((".*?")\\)/.exec(args.code);
    if (openMatch) {
      const openedPath = JSON.parse(openMatch[1]);
      return {
        content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ ok: true, resultingValue: { openedPath, openedName: "fixture" } }) }) }]
      };
    }
    return { content: [{ type: "text", text: "MUTATION - should never be reachable" }] };
    }
  );

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

  it("still never calls ae_get_composition - the malformed ae_list_compositions response stops the manifest build before the per-composition loop is ever reached (the P0 open-project step now runs first and succeeds via the fixture's generic echo, exercised directly by the dedicated open/retry describe block further down)", async () => {
    await writeFakeServer(dir);
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect(request)) as RawInspectionCapture;

    const calledTools = result.toolCalls.map((c) => c.tool);
    expect(calledTools).not.toContain("ae_get_composition");
    expect(result.note).toMatch(/ae_get_composition/);
    expect(result.projectOpenEvidence?.matched).toBe(true);
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
 *
 * Also registers ae_run_jsx, mimicking the real upstream host's own
 * double-JSON-envelope response ({result: "<script's own JSON string>"} -
 * see unwrap-jsx-result.ts) - dispatches on which composition's index the
 * script text targets (buildInspectCompositionPrecompsScript interpolates
 * `app.project.item(<index>)` directly into the script body, so this
 * fixture greps for that substring rather than needing a real inputSchema
 * round-trip for `code`). By default NEITHER composition reports any
 * precomp layers (every pre-existing test in this file keeps assuming
 * both Comp A and Comp B are ordinary, non-nested scenes) -
 * `nestBIntoA: true` opts a test into Comp A reporting Comp B as a
 * nested precomp layer instead; `precompFailsForIndex` makes one
 * composition's own script call fail, to prove that failure never blocks
 * the rest of the manifest.
 */
async function writeRealShapeFakeServer(
  aeMcpPath: string,
  options: {
    compGetFailsForIndex?: number;
    precompFailsForIndex?: number;
    nestBIntoA?: boolean;
    /** P0/P3 fix (2026-09-03): overrides ae_health's projectOpen/projectPath/projectName - lets a test force the "requested project already open" reuse path (see ensureTargetProjectOpen) instead of the default auto-open path every pre-existing test in this fixture relies on. */
    health?: { projectOpen?: boolean; projectPath?: string | null; projectName?: string | null };
    /**
     * P3 fix (2026-09-03): controls the open-project script's own simulated
     * outcome - "success" (default, matches every pre-existing test's
     * assumption) echoes back the exact requested path; "wrong-path"
     * simulates AE opening a DIFFERENT project than requested (proves the
     * P0 verify step fails closed rather than trusting the open call
     * blindly); "op-fails" simulates the script itself reporting
     * app.open() did not succeed.
     */
    openBehavior?: "success" | "wrong-path" | "op-fails";
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

  const server = new McpServer({ name: "fake-ae-mcp-real-shapes", version: "0.0.0" });

  const comps = [
    { index: 3, name: "Comp A", width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 2 },
    { index: 7, name: "Comp B", width: 1080, height: 1920, frameRate: 30, duration: 10, numLayers: 0 }
  ];

  server.registerTool("ae_health", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({
      connected: true,
      ae_running: true,
      health: {
        connected: true,
        aeVersion: "26.3x87",
        ...${JSON.stringify(options.health ?? {})}
      }
    }) }]
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

  server.registerTool("ae_run_jsx", { description: "d", inputSchema: { code: z.string(), args: z.record(z.string(), z.unknown()).optional(), mode: z.string().optional() } }, async (args) => {
    var scriptResult;
    // P0 fix (2026-09-03): the open-project script is now called before
    // any other real inspection tool - generically detected here (checked
    // before the precomp-script branches below) and always reports
    // success, echoing back whatever literal path buildOpenProjectScript
    // embedded, so every pre-existing scenario in this fixture still
    // exercises exactly the same downstream behavior it did before this
    // fix (see the dedicated open/retry fake-server further down for
    // tests that exercise open-project behavior specifically).
    var openMatch = /new File\\((".*?")\\)/.exec(args.code);
    if (openMatch) {
      var openedPath = JSON.parse(openMatch[1]);
      var openBehavior = ${JSON.stringify(options.openBehavior ?? "success")};
      if (openBehavior === "op-fails") {
        return {
          content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ ok: false, failureReason: "app.open() did not return an opened project" }) }) }]
        };
      }
      var resultingOpenedPath = openBehavior === "wrong-path" ? "C:\\\\DYO-Agent\\\\some-other-unrelated-project.aep" : openedPath;
      return {
        content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ ok: true, resultingValue: { openedPath: resultingOpenedPath, openedName: "fixture" } }) }) }]
      };
    }
    if (args.code.indexOf("app.project.item(" + ${JSON.stringify(options.precompFailsForIndex ?? -1)} + ")") !== -1) {
      scriptResult = JSON.stringify({ ok: false, failureReason: "simulated precomp script failure" });
    } else if (args.code.indexOf("app.project.item(3)") !== -1) {
      scriptResult = JSON.stringify({ ok: true, precompLayers: ${options.nestBIntoA ? `[{ layerIndex: 1, layerName: "Nested Comp B Layer", sourceCompositionId: "comp-99" }]` : "[]"} });
    } else if (args.code.indexOf("app.project.item(7)") !== -1) {
      scriptResult = JSON.stringify({ ok: true, precompLayers: [] });
    } else {
      scriptResult = JSON.stringify({ ok: false, failureReason: "unexpected script target in test fixture" });
    }
    return { content: [{ type: "text", text: JSON.stringify({ result: scriptResult }) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

/**
 * P1/P3 fix (2026-09-03, real production incident): a third real fake
 * ae-mcp server, purpose-built to exercise `callWithTransientRetry`'s real
 * retry behavior against `ae_get_project_info`/`ae_list_compositions` -
 * the same two tools a real client job proved can genuinely time out
 * (MCP error -32001) mid-inspection. ae_health always reports the
 * requested project already open at `sourceProjectPath`, so the P0
 * open/verify step takes the cheap reuse path and never calls ae_run_jsx -
 * keeping these tests focused purely on P1's retry logic, not P0's.
 * `projectInfoFailTimes`/`listCompositionsFailTimes` each delay that many
 * calls past the caller's own `mcpTimeoutMs` (triggering a REAL transport
 * timeout, exactly like the real MCP SDK would against a genuinely slow
 * upstream) before responding immediately and successfully on the next
 * call - never a fabricated/synthetic TRANSPORT_ERROR, a real one.
 */
async function writeFlakyDiscoveryFakeServer(
  aeMcpPath: string,
  sourceProjectPath: string,
  options: { projectInfoFailTimes?: number; listCompositionsFailTimes?: number; delayMs?: number } = {}
): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  const delayMs = options.delayMs ?? 400;
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
(async () => {
  const { McpServer } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "mcp.js"))});
  const { StdioServerTransport } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "stdio.js"))});
  const { z } = await import(${JSON.stringify(join(process.cwd(), "node_modules", "zod", "index.js"))});

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  const server = new McpServer({ name: "fake-ae-mcp-flaky", version: "0.0.0" });

  const comps = [
    { index: 3, name: "Comp A", width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 2 },
    { index: 7, name: "Comp B", width: 1080, height: 1920, frameRate: 30, duration: 10, numLayers: 0 }
  ];

  server.registerTool("ae_health", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({
      connected: true,
      ae_running: true,
      health: {
        connected: true,
        aeVersion: "26.3x87",
        projectOpen: true,
        projectPath: ${JSON.stringify(sourceProjectPath)},
        projectName: "template-copy"
      }
    }) }]
  }));

  server.registerTool("ae_list_instances", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ instances: [{ instanceId: "default", aeVersion: "26.3x87" }] }) }]
  }));

  let projectInfoCalls = 0;
  server.registerTool("ae_get_project_info", { description: "d" }, async () => {
    projectInfoCalls++;
    if (projectInfoCalls <= ${JSON.stringify(options.projectInfoFailTimes ?? 0)}) {
      await sleep(${JSON.stringify(delayMs)});
    }
    return { content: [{ type: "text", text: JSON.stringify({ name: "template-copy", path: ${JSON.stringify(sourceProjectPath)}, bitsPerChannel: 8, numItems: 12, compositions: comps }) }] };
  });

  let listCompCalls = 0;
  server.registerTool("ae_list_compositions", { description: "d" }, async () => {
    listCompCalls++;
    if (listCompCalls <= ${JSON.stringify(options.listCompositionsFailTimes ?? 0)}) {
      await sleep(${JSON.stringify(delayMs)});
    }
    return { content: [{ type: "text", text: JSON.stringify(comps) }] };
  });

  const compRefShape = {
    comp_name: z.string().optional(),
    comp_index: z.number().int().positive().optional(),
    response_format: z.enum(["concise", "detailed"]).optional().default("concise")
  };

  server.registerTool("ae_get_composition", { description: "d", inputSchema: compRefShape }, async (args) => {
    if (args.comp_index === 3) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          name: "Comp A", id: 42, width: 1920, height: 1080, frameRate: 30, duration: 5, numLayers: 2, bgColor: [0,0,0],
          layers: [
            { index: 1, name: "Text Layer", enabled: true, inPoint: 0, outPoint: 5, startTime: 0, nullLayer: false, threeDLayer: false, parent: null }
          ]
        }) }]
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({
        name: "Comp B", id: 99, width: 1080, height: 1920, frameRate: 30, duration: 10, numLayers: 0, bgColor: [0,0,0], layers: []
      }) }]
    };
  });

  server.registerTool(
    "ae_run_jsx",
    { description: "d", inputSchema: { code: z.string(), args: z.record(z.string(), z.unknown()).optional(), mode: z.string().optional() } },
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ ok: true, precompLayers: [] }) }) }]
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

describe("HeroicSwanTemplateInspector - P0/P1/P2 target-project open and MCP retry resilience (2026-09-03, real production incident)", () => {
  it("1. requested AEP already open -> no reopen, inspect succeeds", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeRealShapeFakeServer(dir, { health: { projectOpen: true, projectPath: sourceProjectPath, projectName: "template-copy" } });

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    expect(result.kind).toBe("manifest");
    expect(result.projectOpenEvidence).toEqual({
      requestedPath: sourceProjectPath,
      actualOpenedPath: sourceProjectPath,
      reused: true,
      matched: true
    });
  });

  it("2. Untitled project open -> requested AEP automatically opened", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeRealShapeFakeServer(dir, { health: { projectOpen: true, projectPath: null, projectName: "Untitled" } });

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    expect(result.kind).toBe("manifest");
    expect(result.projectOpenEvidence.reused).toBe(false);
    expect(result.projectOpenEvidence.matched).toBe(true);
    expect(result.projectOpenEvidence.actualOpenedPath).toBe(sourceProjectPath);
  });

  it("3. a different AEP open -> requested AEP automatically opened", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeRealShapeFakeServer(dir, {
      health: { projectOpen: true, projectPath: "C:\\\\DYO-Agent\\\\some-other-unrelated-project.aep", projectName: "some-other-unrelated-project" }
    });

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    expect(result.kind).toBe("manifest");
    expect(result.projectOpenEvidence.reused).toBe(false);
    expect(result.projectOpenEvidence.matched).toBe(true);
    expect(result.projectOpenEvidence.actualOpenedPath).toBe(sourceProjectPath);
  });

  it("4. open succeeds but the actual opened path mismatches the requested path -> fails closed", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeRealShapeFakeServer(dir, { openBehavior: "wrong-path" });

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

    expect(result.kind).toBe("raw_capture");
    expect(result.projectOpenEvidence?.matched).toBe(false);
    expect(result.projectOpenEvidence?.reused).toBe(false);
    expect(result.projectOpenEvidence?.actualOpenedPath).not.toBe(sourceProjectPath);
    expect(result.note).toMatch(/Could not confirm the requested target project is open/);
    // 9. no other discovery tool was attempted, and the source AEP was
    // never even hashed - the only tool call captured is the initial
    // ae_health check.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.tool).toBe("ae_health");
  });

  it("5. the project-open operation itself fails -> inspection fails clearly, closed, no manifest", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeRealShapeFakeServer(dir, { openBehavior: "op-fails" });

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

    expect(result.kind).toBe("raw_capture");
    expect(result.projectOpenEvidence?.matched).toBe(false);
    expect(result.note).toMatch(/the open-project script itself reported a failure/);
    expect(result.toolCalls).toHaveLength(1);
  });

  it(
    "6. ae_get_project_info times out once, then succeeds -> inspection continues to a full manifest",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      await writeFlakyDiscoveryFakeServer(dir, sourceProjectPath, { projectInfoFailTimes: 1, delayMs: 5000 });

      const inspector = new HeroicSwanTemplateInspector({
        aeMcpPath: dir,
        mcpTimeoutMs: 3500,
        retryOptions: { maxAttempts: 3, policy: { baseMs: 1, maxMs: 1 } }
      });
      const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

      expect(result.kind).toBe("manifest");
      expect(result.response.manifest.compositions).toHaveLength(2);
    },
    30_000
  );

  it(
    "7. ae_list_compositions times out repeatedly, then succeeds within budget -> inspection continues to a full manifest",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      await writeFlakyDiscoveryFakeServer(dir, sourceProjectPath, { listCompositionsFailTimes: 2, delayMs: 5000 });

      const inspector = new HeroicSwanTemplateInspector({
        aeMcpPath: dir,
        mcpTimeoutMs: 3500,
        retryOptions: { maxAttempts: 3, policy: { baseMs: 1, maxMs: 1 } }
      });
      const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

      expect(result.kind).toBe("manifest");
      expect(result.response.manifest.compositions).toHaveLength(2);
    },
    30_000
  );

  it(
    "8. repeated MCP timeouts exhaust the retry budget -> inspection fails, no manifest is ever persisted",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      // Always times out - more failures than maxAttempts ever allows
      // through. ae_list_compositions specifically, because (pre-existing
      // behavior, unrelated to this P1 fix) it is the one discovery tool
      // whose failure actually gates manifest-building - ae_get_project_info
      // is captured for diagnostics only and is never load-bearing on its
      // own (see the `discovery`/`listCompositionsCall` gate below).
      await writeFlakyDiscoveryFakeServer(dir, sourceProjectPath, { listCompositionsFailTimes: 999, delayMs: 5000 });

      const inspector = new HeroicSwanTemplateInspector({
        aeMcpPath: dir,
        mcpTimeoutMs: 3500,
        retryOptions: { maxAttempts: 3, policy: { baseMs: 1, maxMs: 1 } }
      });
      const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

      expect(result.kind).toBe("raw_capture");
      const listCompositions = result.toolCalls.find((c) => c.tool === "ae_list_compositions");
      expect(listCompositions?.ok).toBe(false);
      expect(listCompositions?.error?.code).toBe("TRANSPORT_ERROR");
      expect(result.note).toMatch(/ae_list_compositions failed/);
    },
    30_000
  );

  it("9. the source AEP is never touched/hashed when the P0 open-check fails early (companion assertion to test 4/5)", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeRealShapeFakeServer(dir, { openBehavior: "op-fails" });

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

    expect(result.kind).toBe("raw_capture");
    // hash-source-project.ts is only ever reached from deeper in the
    // manifest-build path - never invoked at all here, so the source file
    // on disk is provably untouched (still exactly its original bytes).
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(sourceProjectPath, "utf8")).toBe("sanitized fixture bytes");
    expect(result.note).not.toMatch(/hash/i);
  });

  it(
    "10. the whole auto-open + retry flow completes purely through code - no manual client AE interaction is required or assumed",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      // Untitled open (no manual client action taken) AND a transient MCP
      // timeout on the way - both resolved automatically by the worker.
      await writeFlakyDiscoveryFakeServer(dir, sourceProjectPath, { projectInfoFailTimes: 1, delayMs: 5000 });

      const inspector = new HeroicSwanTemplateInspector({
        aeMcpPath: dir,
        mcpTimeoutMs: 3500,
        retryOptions: { maxAttempts: 3, policy: { baseMs: 1, maxMs: 1 } }
      });
      const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

      expect(result.kind).toBe("manifest");
      expect(result.projectOpenEvidence.matched).toBe(true);
    },
    30_000
  );
});

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

  it("falls back to a raw capture (never even attempts to hash) when sourceProjectPath is a directory with no .aep filename - real production bug, 2026-08-30 (C:\\DYO-Agent\\copy accepted and reported SUCCEEDED)", async () => {
    await writeRealShapeFakeServer(dir);
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });

    const result = (await inspector.inspect({
      templateId: "tmpl-1",
      sourceProjectPath: dir
    })) as RawInspectionCapture;

    expect(result.kind).toBe("raw_capture");
    expect(result.note).toMatch(/does not end in \.aep/);
  });

  it("falls back to a raw capture when sourceProjectPath is a real, existing file but not a .aep", async () => {
    await writeRealShapeFakeServer(dir);
    const notAnAep = join(dir, "notes.txt");
    await writeFile(notAnAep, "not an aep");
    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });

    const result = (await inspector.inspect({
      templateId: "tmpl-1",
      sourceProjectPath: notAnAep
    })) as RawInspectionCapture;

    expect(result.kind).toBe("raw_capture");
    expect(result.note).toMatch(/does not end in \.aep/);
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

  it("computes real isNestedOnlyReferenced/parentCompositionIds from the composition-precomps script - client-facing UX redesign, LIVE UX ACCEPTANCE FAILED follow-up", async () => {
    await writeRealShapeFakeServer(dir, { nestBIntoA: true });
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    expect(result.kind).toBe("manifest");
    const manifest = result.response.manifest;
    const compA = manifest.compositions.find((c) => c.compositionId === "comp-42");
    const compB = manifest.compositions.find((c) => c.compositionId === "comp-99");
    // Comp A's own layers reference Comp B as a precomp - Comp B is real,
    // evidence-based nested content, never guessed from its name.
    expect(compB?.isNestedOnlyReferenced).toBe(true);
    expect(compB?.parentCompositionIds).toEqual(["comp-42"]);
    // Comp A itself is never referenced by anything - it stays a real top-level composition.
    expect(compA?.isNestedOnlyReferenced).toBe(false);
    expect(compA?.parentCompositionIds).toEqual([]);
  });

  it("a failed precomps-script call for one composition never blocks the manifest - that composition's own nesting facts simply stay false/[]", async () => {
    await writeRealShapeFakeServer(dir, { precompFailsForIndex: 3 });
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");

    const inspector = new HeroicSwanTemplateInspector({ aeMcpPath: dir });
    const result = (await inspector.inspect({ templateId: "tmpl-1", sourceProjectPath })) as ManifestInspectionResult;

    expect(result.kind).toBe("manifest");
    const manifest = result.response.manifest;
    // Comp A's own precomps call failed - Comp B never gets a parent from it, but the manifest still builds successfully.
    const compB = manifest.compositions.find((c) => c.compositionId === "comp-99");
    expect(compB?.isNestedOnlyReferenced).toBe(false);
    expect(compB?.parentCompositionIds).toEqual([]);
  });
});

/**
 * Single-open + poll-not-reopen reliability fix (2026-09-03, real
 * production incident #3): a real client trace proved app.open() itself
 * can genuinely exceed the ordinary 15s MCP timeout, that the OLD generic
 * P1 retry wrapper then re-issued app.open() on every one of 3
 * consecutive timeouts, and that AE was STILL on "Untitled"/null ~48
 * minutes later (proven via a live, read-only CHECK_HEALTH dispatch) -
 * not "the open worked but the response was slow." This fake server lets
 * a test drive that exact scenario deterministically and fast:
 * `openHangs: true` makes the open-project ae_run_jsx call never respond
 * within any reasonable test timeout (so the client's own configured
 * timeoutMs always fires first, exactly like the real -32001 timeout);
 * `healthSequence` scripts what ae_health reports on each successive
 * call (1-indexed - call 1 is always `inspect()`'s own upfront
 * reuse-check call, never a poll call), the last entry repeating once
 * exhausted; `healthDelayFromCall`/`healthDelayCount` make a specific
 * range of calls additionally delay past the client's mcpTimeoutMs first
 * (simulating a real transient MCP timeout DURING polling specifically,
 * which callWithTransientRetry already retries within a single poll
 * iteration).
 */
async function writeOpenPollFakeServer(
  aeMcpPath: string,
  sourceProjectPath: string,
  options: {
    openHangs?: boolean;
    healthSequence?: ("null" | "target" | "wrong")[];
    /** 1-indexed ae_health call number to start delaying from - defaults to never delaying. Lets a test target a POLL call specifically, distinct from the very first (index 1) call, which is always `inspect()`'s own upfront reuse-check call, never a poll call. */
    healthDelayFromCall?: number;
    /** How many consecutive calls, starting at healthDelayFromCall, delay past the client's own timeout. */
    healthDelayCount?: number;
    wrongPath?: string;
  } = {}
): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  const sequence = options.healthSequence ?? ["target"];
  const healthDelayFromCall = options.healthDelayFromCall ?? 1;
  const healthDelayCount = options.healthDelayCount ?? 0;
  const wrongPath = options.wrongPath ?? "C:\\DYO-Agent\\some-other-unrelated-project.aep";
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
(async () => {
  const { McpServer } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "mcp.js"))});
  const { StdioServerTransport } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "stdio.js"))});
  const { z } = await import(${JSON.stringify(join(process.cwd(), "node_modules", "zod", "index.js"))});
  const { writeFileSync } = await import("node:fs");

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  const server = new McpServer({ name: "fake-ae-mcp-open-poll", version: "0.0.0" });
  const openScriptCallsFile = ${JSON.stringify(join(aeMcpPath, "open-script-calls.txt"))};

  const sequence = ${JSON.stringify(sequence)};
  const healthDelayFromCall = ${JSON.stringify(healthDelayFromCall)};
  const healthDelayCount = ${JSON.stringify(healthDelayCount)};
  const sourceProjectPath = ${JSON.stringify(sourceProjectPath)};
  const wrongPath = ${JSON.stringify(wrongPath)};
  let healthCalls = 0;
  let openScriptCalls = 0;

  server.registerTool("ae_health", { description: "d" }, async () => {
    healthCalls++;
    if (healthCalls >= healthDelayFromCall && healthCalls < healthDelayFromCall + healthDelayCount) {
      await sleep(999999);
    }
    const idx = Math.min(healthCalls - 1, sequence.length - 1);
    const entry = sequence[idx];
    const projectPath = entry === "target" ? sourceProjectPath : entry === "wrong" ? wrongPath : null;
    return {
      content: [{ type: "text", text: JSON.stringify({
        connected: true, ae_running: true,
        health: { connected: true, aeVersion: "26.3x87", projectOpen: entry !== "null", projectName: entry === "null" ? "Untitled" : "fixture", projectPath: projectPath }
      }) }]
    };
  });

  server.registerTool("ae_list_instances", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ instances: [{ instanceId: "default", aeVersion: "26.3x87" }] }) }]
  }));
  server.registerTool("ae_get_project_info", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ name: "fixture", path: sourceProjectPath, bitsPerChannel: 8, numItems: 1, compositions: [] }) }]
  }));
  // Deliberately malformed - the point of these tests is projectOpenEvidence
  // alone, not a full manifest build (see writeFakeServer's own precedent).
  server.registerTool("ae_list_compositions", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify([{ some_unconfirmed_field: "value" }]) }]
  }));
  server.registerTool("ae_get_composition", { description: "d" }, async () => ({
    content: [{ type: "text", text: "should never be called" }]
  }));

  server.registerTool(
    "ae_run_jsx",
    { description: "d", inputSchema: { code: z.string(), args: z.record(z.string(), z.unknown()).optional(), mode: z.string().optional() } },
    async (args) => {
      const openMatch = /new File\\((".*?")\\)/.exec(args.code);
      if (openMatch) {
        openScriptCalls++;
        // Written synchronously, BEFORE any hang below, and persisted to
        // disk (not just in-memory) - the inspector kills this whole
        // child process once its own client-side timeout fires, so an
        // in-memory-only counter (or an MCP tool exposing it) would be
        // unobservable once that happens. This file survives the kill.
        writeFileSync(openScriptCallsFile, String(openScriptCalls), "utf8");
        if (${JSON.stringify(Boolean(options.openHangs))}) {
          await sleep(999999);
        }
        const openedPath = JSON.parse(openMatch[1]);
        return {
          content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ ok: true, resultingValue: { openedPath, openedName: "fixture" } }) }) }]
        };
      }
      return { content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ ok: false, failureReason: "unexpected script target in test fixture" }) }) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

describe("HeroicSwanTemplateInspector - single-open + poll-not-reopen (2026-09-03, real production incident #3)", () => {
  // Generous (not razor-thin) margins - real spawn/dynamic-import connect()
  // overhead and full-test-suite parallel CPU contention have both proven,
  // earlier in this same file's own P1 retry tests, capable of pushing a
  // too-tight timeout into real (not just simulated) flakiness.
  const FAST_MCP_TIMEOUT_MS = 1500;
  const FAST_OPEN_OPTIONS = { timeoutMs: 800, pollBudgetMs: 3000, pollIntervalMs: 300 };
  const FAST_RETRY_OPTIONS = { maxAttempts: 3, policy: { baseMs: 1, maxMs: 1 } };
  const HANG_TEST_TIMEOUT_MS = 20_000;

  function fastInspector(): HeroicSwanTemplateInspector {
    return new HeroicSwanTemplateInspector({
      aeMcpPath: dir,
      mcpTimeoutMs: FAST_MCP_TIMEOUT_MS,
      openProjectOptions: FAST_OPEN_OPTIONS,
      retryOptions: FAST_RETRY_OPTIONS
    });
  }

  it("1. target already open -> zero app.open calls", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeOpenPollFakeServer(dir, sourceProjectPath, { healthSequence: ["target"] });

    const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

    expect(result.projectOpenEvidence?.reused).toBe(true);
    expect(result.projectOpenEvidence?.matched).toBe(true);
  });

  it("2. different/Untitled project -> exactly one app.open call, which completes normally -> success", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeOpenPollFakeServer(dir, sourceProjectPath, { healthSequence: ["null"], openHangs: false });

    const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

    expect(result.projectOpenEvidence?.reused).toBe(false);
    expect(result.projectOpenEvidence?.matched).toBe(true);
    expect(result.projectOpenEvidence?.actualOpenedPath).toBe(sourceProjectPath);
    const callCount = await readFile(join(dir, "open-script-calls.txt"), "utf8");
    expect(callCount).toBe("1");
  });

  it(
    "3. app.open times out but health polling later reports the exact target -> success",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      // Call 1 (inspect()'s own upfront reuse-check) reports null/Untitled -
      // not reused, so the single app.open() attempt runs (and hangs).
      // Poll call 2 still reports null (AE genuinely still loading); poll
      // call 3 onward reports the real target - simulating the open
      // finishing on its own after the client had already given up
      // waiting on that one abandoned request.
      await writeOpenPollFakeServer(dir, sourceProjectPath, { openHangs: true, healthSequence: ["null", "null", "target"] });

      const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

      expect(result.projectOpenEvidence?.reused).toBe(false);
      expect(result.projectOpenEvidence?.matched).toBe(true);
      expect(result.projectOpenEvidence?.actualOpenedPath).toBe(sourceProjectPath);
    },
    HANG_TEST_TIMEOUT_MS
  );

  it(
    "4. app.open times out and projectPath stays null -> fails closed after the bounded polling budget",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      await writeOpenPollFakeServer(dir, sourceProjectPath, { openHangs: true, healthSequence: ["null"] });

      const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

      expect(result.projectOpenEvidence?.matched).toBe(false);
      expect(result.projectOpenEvidence?.actualOpenedPath).toBeNull();
      expect(result.projectOpenEvidence?.note).toMatch(/timed out and the target project never appeared within the bounded polling budget/);
      expect(result.projectOpenEvidence?.note).toMatch(/no app\.open\(\) retry was attempted/);
    },
    HANG_TEST_TIMEOUT_MS
  );

  it(
    "5. app.open times out and projectPath becomes a different, wrong file -> fails closed immediately, never treated as success",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      await writeOpenPollFakeServer(dir, sourceProjectPath, { openHangs: true, healthSequence: ["wrong"] });

      const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

      expect(result.projectOpenEvidence?.matched).toBe(false);
      expect(result.projectOpenEvidence?.actualOpenedPath).toBe("C:\\DYO-Agent\\some-other-unrelated-project.aep");
      expect(result.projectOpenEvidence?.note).toMatch(/does not exactly match the requested sourceProjectPath/);
    },
    HANG_TEST_TIMEOUT_MS
  );

  it(
    "6. a transient health-polling timeout, then the target appears -> success within budget",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      // Call 1 (upfront reuse-check) reports null - not reused, single
      // app.open() attempt hangs. The FIRST poll's own health call (call 2)
      // itself times out - a real, separate transient MCP failure DURING
      // polling - callWithTransientRetry's own retry (already used for
      // every ordinary read-only call) absorbs it within that same poll
      // iteration, and the very next underlying attempt (call 3) succeeds,
      // reporting the target already open.
      await writeOpenPollFakeServer(dir, sourceProjectPath, {
        openHangs: true,
        healthSequence: ["null", "target"],
        healthDelayFromCall: 2,
        healthDelayCount: 1
      });

      const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

      expect(result.projectOpenEvidence?.matched).toBe(true);
      expect(result.projectOpenEvidence?.actualOpenedPath).toBe(sourceProjectPath);
    },
    HANG_TEST_TIMEOUT_MS
  );

  it(
    "7. exactly one app.open invocation even across the timeout -> poll path (never a second app.open call)",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      await writeOpenPollFakeServer(dir, sourceProjectPath, { openHangs: true, healthSequence: ["null", "null", "target"] });

      const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;
      expect(result.projectOpenEvidence?.matched).toBe(true);

      // The fake server writes this file, synchronously, on every real
      // ae_run_jsx invocation whose code matches the open-project script -
      // written to disk (not just in-memory) so it survives the child
      // process being killed once the inspector's own timeout fires,
      // proving the real server-side call count, not just what the client
      // happened to observe (which a race could make misleading).
      const callCount = await readFile(join(dir, "open-script-calls.txt"), "utf8");
      expect(callCount).toBe("1");
    },
    HANG_TEST_TIMEOUT_MS
  );

  it(
    "8. no save operation is ever invoked, whether the open succeeds immediately or via the timeout -> poll path",
    async () => {
      const sourceProjectPath = join(dir, "template-copy.aep");
      await writeFile(sourceProjectPath, "sanitized fixture bytes");
      // Static confirmation - the generated script never references save at all.
      const script = buildOpenProjectScript(sourceProjectPath);
      expect(script).not.toContain(".save(");

      // The fixture's own ae_run_jsx handler never defines or calls a
      // "save" operation at all (see writeOpenPollFakeServer above) - if
      // buildOpenProjectScript's generated JSX ever called
      // app.project.save(), there is nothing here to make that call
      // silently succeed, so any such regression would surface as an
      // unexpected script/process failure in this same test run instead
      // of a clean pass.
      await writeOpenPollFakeServer(dir, sourceProjectPath, { openHangs: true, healthSequence: ["target"] });
      const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;
      expect(result.projectOpenEvidence?.matched).toBe(true);
    },
    HANG_TEST_TIMEOUT_MS
  );

  it("9. dialog suppression is still always released, even when the open call itself times out (proven at the buildOpenProjectScript unit level - see jsx-templates.test.ts's own dedicated describe block for the full behavioral proof, including a real vm-executed timeout/exception scenario)", () => {
    const sourceProjectPath = "C:\\DYO-Agent\\copy\\template.aep";
    const script = buildOpenProjectScript(sourceProjectPath);
    expect(script).toContain("app.beginSuppressDialogs();");
    expect(script).toContain("app.endSuppressDialogs(false);");
    const beginIndex = script.indexOf("app.beginSuppressDialogs();");
    const finallyIndex = script.indexOf("app.endSuppressDialogs(false);");
    expect(beginIndex).toBeLessThan(finallyIndex);
  });

  it("10. normal MCP discovery retry behavior remains unchanged - a transient ae_list_instances timeout still retries and succeeds, unaffected by the OPEN_PROJECT-specific timeout/poll path", async () => {
    const sourceProjectPath = join(dir, "template-copy.aep");
    await writeFile(sourceProjectPath, "sanitized fixture bytes");
    await writeOpenPollFakeServer(dir, sourceProjectPath, { healthSequence: ["target"] });

    const result = (await fastInspector().inspect({ templateId: "tmpl-1", sourceProjectPath })) as RawInspectionCapture;

    // Reused (health already showed the target) - ordinary discovery
    // tools still ran afterward exactly as before this fix.
    expect(result.projectOpenEvidence?.reused).toBe(true);
    expect(result.toolCalls.map((c) => c.tool)).toContain("ae_list_instances");
  });

  it("11. structural invariant: ensureTargetProjectOpen's app.open() call is never routed through callWithTransientRetry - only a single direct client.runFixedInspectionScript call", async () => {
    const source = await readFile(new URL("./heroic-swan-template-inspector.ts", import.meta.url), "utf8");
    const fnStart = source.indexOf("async function ensureTargetProjectOpen(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = source.indexOf("\nfunction rawCaptureFor(", fnStart);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    // The open call itself is a bare client.runFixedInspectionScript(...)
    // - never wrapped in callWithTransientRetry, which is the generic
    // path that would silently re-fire app.open() on a timeout.
    expect(fnBody).toContain("client.runFixedInspectionScript(script, timeoutMs)");
    expect(fnBody).not.toMatch(/callWithTransientRetry\(\s*[\s\S]*?client\.runFixedInspectionScript\(script/);
  });
});
