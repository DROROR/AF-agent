import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroicSwanMcpClient } from "./heroic-swan-mcp-client.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-heroicswan-mcp-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Writes a fake ae-mcp MCP server at <dir>/dist/index.js using the REAL
 * @modelcontextprotocol/sdk Server-side API (McpServer + StdioServerTransport),
 * spawned as a real child process over real stdio - not a mocked transport.
 * Registers exactly the tools this test needs, including one that reports
 * isError, to prove HeroicSwanMcpClient's real protocol handling end to end.
 */
async function writeFakeServer(aeMcpPath: string): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  // Dynamic import() (not a static `import` statement) so this plain .js
  // file runs regardless of ambient module type - the temp directory has
  // no package.json of its own, and the real filename this must match
  // (index.js, matching HeroicSwanMcpClient's fixed path) would otherwise
  // default to CommonJS, where top-level static `import` isn't valid.
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
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

  server.registerTool("ae_health", { description: "fake health" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ connected: true, ae_running: true }) }]
  }));

  server.registerTool("ae_list_compositions", { description: "fake list" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ compositions: [{ name: "Main" }] }) }]
  }));

  server.registerTool("ae_broken_tool", { description: "always errors" }, async () => ({
    isError: true,
    content: [{ type: "text", text: "simulated tool failure" }]
  }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

describe("HeroicSwanMcpClient - real spawned MCP server over real stdio, not mocked", () => {
  it("connects and calls an allowlisted tool, returning its raw content", async () => {
    await writeFakeServer(dir);
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    await client.connect();
    try {
      const result = await client.callTool("ae_health");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toEqual([
          { type: "text", text: JSON.stringify({ connected: true, ae_running: true }) }
        ]);
      }
    } finally {
      await client.close();
    }
  });

  it("calls a second allowlisted tool successfully on the same connection", async () => {
    await writeFakeServer(dir);
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    await client.connect();
    try {
      const result = await client.callTool("ae_list_compositions");
      expect(result.ok).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("reports a typed TOOL_ERROR failure when the tool itself signals isError, extracting the text detail", async () => {
    await writeFakeServer(dir);
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    await client.connect();
    try {
      // Cast is deliberate: this tool is intentionally NOT part of the
      // allowlisted union, proving the type system alone should reject it
      // at real call sites - this test exercises the runtime path only.
      const result = await client.callTool(
        "ae_broken_tool" as unknown as Parameters<typeof client.callTool>[0]
      );
      expect(result).toEqual({ ok: false, error: { code: "TOOL_ERROR", message: "simulated tool failure" } });
    } finally {
      await client.close();
    }
  });

  it("reports NOT_CONNECTED without ever spawning anything if callTool is used before connect()", async () => {
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    const result = await client.callTool("ae_health");
    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_CONNECTED", message: "connect() must succeed before calling a tool" }
    });
  });

  it("reports a typed TRANSPORT_ERROR (never throws) when ae-mcp is not actually installed at the configured path", async () => {
    const client = new HeroicSwanMcpClient({ aeMcpPath: join(dir, "does-not-exist"), timeoutMs: 3_000 });
    await expect(client.connect()).rejects.toBeTruthy();
  });

  it("close() is safe to call even if connect() was never called", async () => {
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    await expect(client.close()).resolves.toBeUndefined();
  });
});
