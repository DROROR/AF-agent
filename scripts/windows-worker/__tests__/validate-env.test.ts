import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const validatorPath = join(currentDir, "..", "..", "windows-worker-validate-env.mjs");

/**
 * Executable regression coverage (spawns real Node, not source-text
 * assertions) for the root cause of a real client failure: a .env file
 * written with a leading UTF-8 BOM causes Node's --env-file parser to
 * silently fold the BOM into the FIRST key it parses, undefined-ing that
 * one variable while every later variable in the file still loads fine.
 * PowerShell's Get-Content is BOM-transparent and would report the same
 * file as complete - this test proves what Node itself actually sees.
 */
describe("dist/validate-env.js against real `node --env-file=` behavior", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function run(envPath: string, args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [`--env-file=${envPath}`, validatorPath, ...args], {
        encoding: "utf8"
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const execError = error as { status: number; stdout: string; stderr: string };
      return { status: execError.status, stdout: execError.stdout, stderr: execError.stderr };
    }
  }

  it("passes when the .env is written as UTF-8 without a BOM (the fixed writer's output)", () => {
    dir = mkdtempSync(join(tmpdir(), "dyo-env-nobom-"));
    const envPath = join(dir, ".env");
    // No BOM: plain Buffer.from(..., "utf8") never prepends one - this
    // mirrors System.Text.UTF8Encoding($false) in Write-Utf8NoBomFile.
    writeFileSync(envPath, "DYO_API_URL=https://example.test\nWORKER_NAME=TEST\n", "utf8");

    const result = run(envPath, ["DYO_API_URL", "WORKER_NAME"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("OK");
  });

  it("fails on the first-declared key only when the .env carries a leading UTF-8 BOM - reproducing the real client failure", () => {
    dir = mkdtempSync(join(tmpdir(), "dyo-env-bom-"));
    const envPath = join(dir, ".env");
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from("DYO_API_URL=https://example.test\nWORKER_NAME=TEST\n", "utf8");
    writeFileSync(envPath, Buffer.concat([bom, body]));

    const result = run(envPath, ["DYO_API_URL", "WORKER_NAME"]);
    expect(result.status).toBe(1);
    // Only the first-declared key is corrupted - proves the BOM folds into
    // the first key's name rather than breaking the whole file.
    expect(result.stderr).toContain("MISSING:DYO_API_URL");
    expect(result.stderr).not.toContain("WORKER_NAME");
  });

  it("fails when a required key is genuinely absent from an otherwise-clean file", () => {
    dir = mkdtempSync(join(tmpdir(), "dyo-env-missing-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "WORKER_NAME=TEST\n", "utf8");

    const result = run(envPath, ["DYO_API_URL", "WORKER_NAME"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MISSING:DYO_API_URL");
  });

  it("never prints the value of a required key on success or failure, only key names", () => {
    dir = mkdtempSync(join(tmpdir(), "dyo-env-novalue-"));
    const envPath = join(dir, ".env");
    const secretValue = "sk-should-never-appear-in-output";
    writeFileSync(envPath, `WORKER_REGISTRATION_SECRET=${secretValue}\n`, "utf8");

    const passing = run(envPath, ["WORKER_REGISTRATION_SECRET"]);
    expect(passing.stdout).not.toContain(secretValue);
    expect(passing.stderr).not.toContain(secretValue);

    const failing = run(envPath, ["WORKER_REGISTRATION_SECRET", "DYO_API_URL"]);
    expect(failing.stdout).not.toContain(secretValue);
    expect(failing.stderr).not.toContain(secretValue);
  });

  it("exits 2 with no keys given, distinguishing a caller bug from a config problem", () => {
    dir = mkdtempSync(join(tmpdir(), "dyo-env-noargs-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "DYO_API_URL=https://example.test\n", "utf8");

    const result = run(envPath, []);
    expect(result.status).toBe(2);
  });
});
