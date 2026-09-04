import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroicSwanMcpClient } from "./heroic-swan-mcp-client.js";

/**
 * Compile-time proof (not just a runtime check) that ae_run_jsx cannot be
 * dispatched through this client: callTool's parameter type is a closed
 * union of exactly the five allowlisted read-only tool names, so this
 * line fails to typecheck (`npm run typecheck`/`tsc` errors) without the
 * `@ts-expect-error` - and if AllowedInspectionTool were ever widened to
 * include "ae_run_jsx", the now-valid call would make the suppressed
 * error go missing, which itself fails typecheck (`@ts-expect-error`
 * requires a real error to suppress). Never actually invoked.
 */
function assertAeRunJsxCannotBeDispatched(client: HeroicSwanMcpClient): void {
  // @ts-expect-error - "ae_run_jsx" is not assignable to AllowedInspectionTool
  void client.callTool("ae_run_jsx");
}
void assertAeRunJsxCannotBeDispatched;

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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a fake ae-mcp server that ignores SIGTERM entirely - proves
 * terminate()'s real kill sequence (delegated to the MCP SDK's own
 * StdioClientTransport.close(): stdin end, then SIGTERM, then SIGKILL)
 * actually reaches the SIGKILL fallback rather than silently giving up
 * once SIGTERM is ignored (P5 regression test 3, 2026-09-04).
 */
async function writeSigtermIgnoringServer(aeMcpPath: string): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
process.on("SIGTERM", () => {});
(async () => {
  const { McpServer } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "mcp.js"))});
  const { StdioServerTransport } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "stdio.js"))});
  const server = new McpServer({ name: "fake-ae-mcp-sigterm-ignoring", version: "0.0.0" });
  server.registerTool("ae_health", { description: "d" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ connected: true }) }]
  }));
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

describe("HeroicSwanMcpClient - P0 owns and can prove termination of its own ae-mcp child process (2026-09-04)", () => {
  it("pid is null before connect(), a real positive PID after connect(), and null again after terminate()", async () => {
    await writeFakeServer(dir);
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    expect(client.pid).toBeNull();
    await client.connect();
    expect(client.pid).not.toBeNull();
    expect(client.pid).toBeGreaterThan(0);
    const pid = client.pid as number;
    expect(isProcessAlive(pid)).toBe(true);

    const outcome = await client.terminate("test");
    expect(client.pid).toBeNull();
    expect(outcome).toEqual({ outcome: "terminated", pid, reason: "test", durationMs: expect.any(Number) });
    expect(isProcessAlive(pid)).toBe(false);
  });

  it("P5 test 2: an ordinary graceful close() confirms the process is actually gone, not merely that close() resolved", async () => {
    await writeFakeServer(dir);
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    await client.connect();
    const pid = client.pid as number;

    await client.close();

    expect(isProcessAlive(pid)).toBe(false);
  });

  it("P5 test 3: when the child ignores SIGTERM, terminate() still confirms it stopped (the SDK's own SIGKILL fallback is reached)", async () => {
    await writeSigtermIgnoringServer(dir);
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    await client.connect();
    const pid = client.pid as number;
    expect(isProcessAlive(pid)).toBe(true);

    const outcome = await client.terminate("sigterm-ignoring test");

    expect(outcome.outcome).toBe("terminated");
    expect(isProcessAlive(pid)).toBe(false);
  }, 15_000);

  it("terminate() is idempotent - concurrent calls share one outcome and only run the real kill sequence once", async () => {
    await writeFakeServer(dir);
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    await client.connect();
    const pid = client.pid as number;

    const [a, b] = await Promise.all([client.terminate("first"), client.terminate("second")]);

    expect(a).toBe(b); // same object - the second call returned the first call's own in-flight promise
    expect(a.reason).toBe("first");
    expect(isProcessAlive(pid)).toBe(false);
  });

  it("terminate() before connect() reports no_process and never throws", async () => {
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir });
    const outcome = await client.terminate("never connected");
    expect(outcome).toEqual({ outcome: "no_process", pid: null, reason: "never connected", durationMs: 0 });
  });

  it("logs PID, reason, and outcome via an injected logger", async () => {
    await writeFakeServer(dir);
    const info = vi.fn();
    const warn = vi.fn();
    const client = new HeroicSwanMcpClient({ aeMcpPath: dir, logger: { info, warn } });
    await client.connect();
    const pid = client.pid as number;

    await client.terminate("logging test");

    expect(info).toHaveBeenCalledWith(expect.objectContaining({ pid, reason: "logging test" }), expect.any(String));
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "terminated", pid, reason: "logging test" }),
      expect.any(String)
    );
  });
});
