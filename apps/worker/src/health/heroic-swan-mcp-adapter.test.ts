import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroicSwanMcpAdapter } from "./heroic-swan-mcp-adapter.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-heroicswan-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Writes a fake ae-mcp CLI at <dir>/dist/index.js that mimics the real
 * `health` subcommand's exit-code contract, without needing the real
 * ae-mcp/AE installed. Also writes upstream's real mixed human+JSON stdout
 * shape (not a clean object) to prove the adapter genuinely never depends
 * on parsing it.
 */
async function writeFakeCli(aeMcpPath: string, exitCode: number): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
    const args = process.argv.slice(2);
    if (args[0] !== "health") {
      console.error("unexpected subcommand: " + args.join(" "));
      process.exit(99);
    }
    console.log("Data dir:", "/fake/.ae-mcp");
    console.log("AE running:", true);
    console.log("Ensure:", JSON.stringify({ ok: true, message: "fake" }, null, 2));
    console.log("Live instances:", 1);
    process.exit(${exitCode});
    `,
    "utf8"
  );
}

describe("HeroicSwanMcpAdapter - real spawned CLI process, not mocked", () => {
  it("maps exit code 0 to ONLINE", async () => {
    await writeFakeCli(dir, 0);
    const adapter = new HeroicSwanMcpAdapter({ aeMcpPath: dir });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "ONLINE", mcpConfiguredPath: join(dir, "dist", "index.js") });
  });

  it("maps exit code 1 (bridge not connected) to OFFLINE - real evidence of not-running", async () => {
    await writeFakeCli(dir, 1);
    const adapter = new HeroicSwanMcpAdapter({ aeMcpPath: dir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("OFFLINE");
  });

  it("maps exit code 2 (health invocation itself failed) to UNKNOWN - ambiguous, never fabricated", async () => {
    await writeFakeCli(dir, 2);
    const adapter = new HeroicSwanMcpAdapter({ aeMcpPath: dir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("maps an unrecognized exit code to UNKNOWN rather than guessing", async () => {
    await writeFakeCli(dir, 7);
    const adapter = new HeroicSwanMcpAdapter({ aeMcpPath: dir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("reports UNKNOWN with a null path when AE_MCP_PATH is not configured at all", async () => {
    const adapter = new HeroicSwanMcpAdapter({ aeMcpPath: undefined });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "UNKNOWN", mcpConfiguredPath: null });
  });

  it("reports UNKNOWN when the script does not exist (ae-mcp not actually installed at the configured path)", async () => {
    const adapter = new HeroicSwanMcpAdapter({ aeMcpPath: join(dir, "does-not-exist") });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("times out and reports UNKNOWN rather than hanging forever if the bridge never responds", async () => {
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(
      join(dir, "dist", "index.js"),
      `setTimeout(() => process.exit(0), 60_000);`,
      "utf8"
    );
    const adapter = new HeroicSwanMcpAdapter({ aeMcpPath: dir, timeoutMs: 200 });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  }, 10_000);

  it("invokes the exact fixed script path and subcommand - never a shell string, never extra arguments", async () => {
    await mkdir(join(dir, "dist"), { recursive: true });
    // Fails loudly (nonzero, distinguishable exit code) if invoked with
    // anything other than exactly one argument, "health".
    await writeFile(
      join(dir, "dist", "index.js"),
      `
      const args = process.argv.slice(2);
      process.exit(args.length === 1 && args[0] === "health" ? 0 : 42);
      `,
      "utf8"
    );
    const adapter = new HeroicSwanMcpAdapter({ aeMcpPath: dir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("ONLINE");
  });
});
