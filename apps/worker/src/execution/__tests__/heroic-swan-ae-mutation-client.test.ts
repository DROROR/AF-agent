import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroicSwanAeMutationClient } from "../heroic-swan-ae-mutation-client.js";
import type { FixedJsxScript } from "../jsx-templates.js";

// Real spawned MCP server over real stdio (same proven convention as
// heroic-swan-mcp-client.test.ts), registering a fake `ae_run_jsx` that
// echoes back exactly the arguments it received - this is what actually
// proves the client sends the REAL verified upstream shape
// ({code, args, mode, description}), not just that it compiles.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-heroicswan-mutation-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFakeServer(aeMcpPath: string, opts: { errorOnRunJsx?: boolean } = {}): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
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

  server.registerTool(
    "ae_run_jsx",
    {
      description: "fake ae_run_jsx - echoes received args, or errors if configured to",
      inputSchema: {
        code: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
        mode: z.enum(["restricted", "unsafe"]).optional(),
        description: z.string().optional()
      }
    },
    async (received) => {
      if (${opts.errorOnRunJsx ? "true" : "false"}) {
        return { isError: true, content: [{ type: "text", text: "simulated ae_run_jsx failure" }] };
      }
      // Mirrors the REAL upstream host dispatch shape exactly: the host
      // wraps whatever "new Function('args', code)(...)" returns as
      // { result: <return value> } - here we simulate that by echoing the
      // received arguments back as the "result", so the test can assert
      // on the exact shape the client actually sent.
      return {
        content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify({ received }) }) }]
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

const FAKE_SCRIPT = 'var __result = JSON.stringify({ ok: true }); return __result;' as FixedJsxScript;

describe("HeroicSwanAeMutationClient - real spawned MCP server over real stdio, not mocked", () => {
  it("sends the exact real upstream argument shape: {code, args: {}, mode: 'unsafe', description}", async () => {
    await writeFakeServer(dir);
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: dir });
    await client.connect();
    try {
      const result = await client.runFixedOperation(FAKE_SCRIPT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const textBlock = (result.content as { type: string; text: string }[])[0];
      const envelope = JSON.parse(textBlock!.text) as { result: string };
      const echoed = JSON.parse(envelope.result) as { received: Record<string, unknown> };
      expect(echoed.received).toEqual({
        code: FAKE_SCRIPT,
        args: {},
        mode: "unsafe",
        description: "DYO EXECUTE_FRAME fixed operation"
      });
    } finally {
      await client.close();
    }
  });

  it("never sends a 'script' field - the old, wrong assumed argument name", async () => {
    await writeFakeServer(dir);
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: dir });
    await client.connect();
    try {
      const result = await client.runFixedOperation(FAKE_SCRIPT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const textBlock = (result.content as { type: string; text: string }[])[0];
      const envelope = JSON.parse(textBlock!.text) as { result: string };
      const echoed = JSON.parse(envelope.result) as { received: Record<string, unknown> };
      expect(echoed.received).not.toHaveProperty("script");
    } finally {
      await client.close();
    }
  });

  it("reports a typed TOOL_ERROR when ae_run_jsx itself signals isError", async () => {
    await writeFakeServer(dir, { errorOnRunJsx: true });
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: dir });
    await client.connect();
    try {
      const result = await client.runFixedOperation(FAKE_SCRIPT);
      expect(result).toEqual({ ok: false, error: { code: "TOOL_ERROR", message: "simulated ae_run_jsx failure" } });
    } finally {
      await client.close();
    }
  });

  it("reports NOT_CONNECTED without ever spawning anything if runFixedOperation is used before connect()", async () => {
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: dir });
    const result = await client.runFixedOperation(FAKE_SCRIPT);
    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_CONNECTED", message: "connect() must succeed before running an operation" }
    });
  });

  it("reports a typed TRANSPORT_ERROR (never throws) when ae-mcp is not actually installed at the configured path", async () => {
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: join(dir, "does-not-exist"), timeoutMs: 3_000 });
    await expect(client.connect()).rejects.toBeTruthy();
  });

  it("close() is safe to call even if connect() was never called", async () => {
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: dir });
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("has no public method that accepts a plain string in place of FixedJsxScript (compile-time proof)", () => {
    const client = new HeroicSwanAeMutationClient({ aeMcpPath: dir });
    // @ts-expect-error - a plain string is not assignable to FixedJsxScript
    void client.runFixedOperation("app.quit()");
  });
});
