import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProcessLister, ProcessRunningStatus } from "../infrastructure/process-lister.js";
import { runCheckHealthDiagnostics } from "./run-check-health-diagnostics.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-check-health-diagnostics-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeProcessLister(status: ProcessRunningStatus): ProcessLister {
  return { isImageRunning: async () => status };
}

async function writeFakeCli(aeMcpPath: string, script: string): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  await writeFile(join(aeMcpPath, "dist", "index.js"), script, "utf8");
}

describe("runCheckHealthDiagnostics", () => {
  it("maps exit code 0 to ONLINE and captures real bounded stdout/stderr", async () => {
    await writeFakeCli(
      dir,
      `console.log("Data dir: /fake"); console.error("diag stderr line"); process.exit(0);`
    );
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: dir },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    expect(result.mcpStatus).toBe("ONLINE");
    expect(result.mcpProcess.exitCode).toBe(0);
    expect(result.mcpProcess.aeMcpPathConfigured).toBe(true);
    expect(result.mcpProcess.scriptExists).toBe(true);
    expect(result.mcpProcess.stdout).toContain("Data dir");
    expect(result.mcpProcess.stderr).toContain("diag stderr line");
    expect(result.mcpProcess.timedOut).toBe(false);
  });

  it("maps exit code 1 to OFFLINE - real evidence the bridge is not connected", async () => {
    await writeFakeCli(dir, `process.exit(1);`);
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: dir },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    expect(result.mcpStatus).toBe("OFFLINE");
    expect(result.mcpProcess.exitCode).toBe(1);
  });

  it("maps exit code 2 (and any other unrecognized code) to UNKNOWN - never fabricated", async () => {
    await writeFakeCli(dir, `process.exit(2);`);
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: dir },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProcess.exitCode).toBe(2);
  });

  it("reports scriptExists: false and mcpStatus UNKNOWN when AE_MCP_PATH is configured but dist/index.js does not exist", async () => {
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: join(dir, "does-not-exist") },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProcess.aeMcpPathConfigured).toBe(true);
    expect(result.mcpProcess.scriptExists).toBe(false);
    expect(result.mcpProcess.exitCode).toBeNull();
  });

  it("reports aeMcpPathConfigured: false and scriptExists: null (never checked) when AE_MCP_PATH is not set at all", async () => {
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: undefined },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProcess.aeMcpPathConfigured).toBe(false);
    expect(result.mcpProcess.scriptExists).toBeNull();
  });

  it("distinguishes a real timeout from a normal exit - timedOut true, exitCode null", async () => {
    await writeFakeCli(dir, `setTimeout(() => process.exit(0), 60_000);`);
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: dir, timeoutMs: 200 },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    expect(result.mcpProcess.timedOut).toBe(true);
    expect(result.mcpProcess.exitCode).toBeNull();
    expect(result.mcpStatus).toBe("UNKNOWN");
  }, 10_000);

  it("bounds oversized stdout/stderr from the diagnostic process", async () => {
    await writeFakeCli(dir, `process.stdout.write("x".repeat(50000)); process.exit(0);`);
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: dir },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    expect(result.mcpProcess.stdoutTruncated).toBe(true);
    expect(result.mcpProcess.stdout.length).toBeLessThanOrEqual(10_000);
  });

  it("includes real AE status from detectAeHealth alongside the MCP diagnostic", async () => {
    await writeFakeCli(dir, `process.exit(0);`);
    const result = await runCheckHealthDiagnostics(
      { aePath: "C:\\Program Files\\Adobe\\Adobe After Effects 2026", aerenderPath: undefined, aeMcpPath: dir },
      { processLister: fakeProcessLister("RUNNING") }
    );
    expect(result.aeStatus).toBe("ONLINE");
    expect(result.aeVersion).toBe("2026");
  });

  it("never returns a secret - no token/password/secret-looking field anywhere in the result", async () => {
    await writeFakeCli(dir, `console.log("normal diagnostic output"); process.exit(0);`);
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: dir },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/password/i);
  });

  it("invokes the exact fixed script path and subcommand - never a shell string, never extra/arbitrary arguments", async () => {
    await writeFakeCli(
      dir,
      `
      const args = process.argv.slice(2);
      process.exit(args.length === 1 && args[0] === "health" ? 0 : 42);
      `
    );
    const result = await runCheckHealthDiagnostics(
      { aePath: undefined, aerenderPath: undefined, aeMcpPath: dir },
      { processLister: fakeProcessLister("UNKNOWN") }
    );
    expect(result.mcpStatus).toBe("ONLINE");
  });
});
