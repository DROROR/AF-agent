import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroicSwanTemplateInspector } from "./heroic-swan-template-inspector.js";
import type { RawInspectionCapture } from "./template-inspector.js";

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
