import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RealAerenderRunner, NotAvailableAerenderRunner, AerenderTransportUnavailableError } from "../aerender-runner.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A real, spawnable fake "aerender" executable (a chmod +x node script,
 * never invoked through a shell) that behaves according to the `-comp`
 * value it was called with - lets these tests exercise RealAerenderRunner's
 * REAL spawn/stdout/stderr/exit-code/timeout handling against a real child
 * process, not a mock.
 */
function writeFakeAerender(): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-aerender-"));
  cleanupDirs.push(dir);
  const scriptPath = join(dir, "fake-aerender.js");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const compIndex = args.indexOf("-comp");
const comp = compIndex >= 0 ? args[compIndex + 1] : "";
if (comp.startsWith("SLEEP:")) {
  const ms = Number(comp.slice("SLEEP:".length));
  setTimeout(() => process.exit(0), ms);
} else if (comp.startsWith("EXIT:")) {
  process.stdout.write("fake aerender stdout\\n");
  process.stderr.write("fake aerender stderr\\n");
  process.exit(Number(comp.slice("EXIT:".length)));
} else if (comp === "BIGLOG") {
  // Synchronous fd write (not process.stdout.write, whose async pipe flush
  // can be cut short by an immediate process.exit()) - guarantees the full
  // payload is actually delivered before this process exits.
  require("fs").writeSync(1, "x".repeat(600000));
  process.exit(0);
} else {
  process.exit(0);
}
`,
    "utf8"
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function baseParams(executablePath: string, compName: string, overrides: Record<string, unknown> = {}) {
  return {
    executablePath,
    projectPath: "/work/jobs/job-1/working-copy.aep",
    compName,
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Source",
    outputPath: "/work/jobs/job-1/renders/landscape/output.mp4",
    ...overrides
  };
}

describe("RealAerenderRunner", () => {
  it("spawns directly (no shell) and captures a successful exit, stdout, and stderr", async () => {
    const fake = writeFakeAerender();
    const runner = new RealAerenderRunner();
    const result = await runner.run(baseParams(fake, "EXIT:0"));

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.pid).not.toBeNull();
    expect(result.stdout).toContain("fake aerender stdout");
    expect(result.stderr).toContain("fake aerender stderr");
    expect(result.spawnError).toBeNull();
  });

  it("captures a non-zero exit code without throwing", async () => {
    const fake = writeFakeAerender();
    const runner = new RealAerenderRunner();
    const result = await runner.run(baseParams(fake, "EXIT:1"));

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("reports a spawn error (never throws) when the executable does not exist", async () => {
    const runner = new RealAerenderRunner();
    const result = await runner.run(baseParams("/does/not/exist/aerender", "EXIT:0"));

    expect(result.ok).toBe(false);
    expect(result.spawnError).not.toBeNull();
    expect(result.exitCode).toBeNull();
  });

  it("times out and kills a hung process, reporting timedOut: true", async () => {
    const fake = writeFakeAerender();
    const runner = new RealAerenderRunner();
    const result = await runner.run(baseParams(fake, "SLEEP:5000", { timeoutMs: 200 }));

    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(true); // the process WAS spawned and DID exit (via kill) - ok describes "ran to a real exit", not "succeeded"
  }, 10_000);

  it("bounds captured stdout so a pathological renderer cannot exhaust memory", async () => {
    const fake = writeFakeAerender();
    const runner = new RealAerenderRunner();
    const result = await runner.run(baseParams(fake, "BIGLOG"));

    expect(result.stdout.length).toBeLessThan(600_000);
    expect(result.stdoutTruncated).toBe(true);
  });

  it("never shells out - the child_process.spawn call always passes shell: false (regression guard via source inspection)", () => {
    const source = readFileSync(join(currentDir, "..", "aerender-runner.ts"), "utf8");
    expect(source).toMatch(/shell:\s*false/);
    expect(source).not.toMatch(/\bexec\s*\(/);
    expect(source).not.toMatch(/\bexecFile\s*\(/);
    expect(source).not.toMatch(/cmd\.exe|powershell\.exe/i);
  });
});

describe("NotAvailableAerenderRunner", () => {
  it("never fabricates a result - always throws AerenderTransportUnavailableError", async () => {
    const runner = new NotAvailableAerenderRunner();
    await expect(runner.run(baseParams("/x", "EXIT:0"))).rejects.toBeInstanceOf(AerenderTransportUnavailableError);
  });
});
