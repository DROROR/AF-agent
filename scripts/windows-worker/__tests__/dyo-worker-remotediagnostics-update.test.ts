import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const deployDir = join(process.cwd(), "deploy", "windows-worker");
const updateScript = readFileSync(join(deployDir, "DYO-Worker-RemoteDiagnostics-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-RemoteDiagnostics-Update.bat"), "utf8");

/**
 * DYO-Worker-RemoteDiagnostics-Update.ps1 ships the 2026-09-12 heartbeat
 * permanent-stall fix plus the remote-diagnostics capabilities. It is a
 * direct descendant of the proven StartupRecovery installer, so these tests
 * assert (a) the safety properties inherited from it are still intact -
 * every one of them was a real incident - and (b) the new build markers
 * actually cover THIS release's files.
 */
describe("DYO-Worker-RemoteDiagnostics-Update.ps1", () => {
  it("verifies files that exist only in THIS build, not just dist\\index.js", () => {
    // The real 2026-09-12 stale-payload failure: an installer "succeeded"
    // and the worker then logged a new commit while running old code,
    // because the only file checked existed in every build.
    for (const marker of [
      "dist\\infrastructure\\with-deadline.js",
      "dist\\diagnostics\\run-diagnostic.js",
      "dist\\diagnostics\\redact.js",
      "dist\\diagnostics\\restart-worker-safe.js",
      "dist\\diagnostics\\list-dyo-processes.js"
    ]) {
      expect(updateScript).toContain(marker);
    }
  });

  it("restores BOTH dist and BUILD_INFO.json on rollback", () => {
    // Real 2026-09-12 incident: a rollback restored dist but not
    // BUILD_INFO.json, so old code reported the new commit.
    expect(updateScript).toContain("BUILD_INFO.json");
  });

  it("never matches the ae-mcp bridge when stopping worker processes", () => {
    // Real 2026-09-11 incident: the pattern "dist\index.js" also matched
    // "node <AE_MCP_PATH>\dist\index.js serve" and killed the bridge.
    expect(updateScript).toContain("--env-file=.env dist\\index.js");
    expect(updateScript).not.toMatch(/\[regex\]::Escape\("dist\\index\.js"\)/);
  });

  it("keeps the PID-reuse identity re-verification before any kill", () => {
    expect(updateScript).toContain("Test-IsDyoWorkerProcess");
    expect(updateScript).toContain("CreationDate");
    expect(updateScript).toContain("$SystemProcessIdFloor");
  });

  it("waits for a genuinely healthy worker tree rather than sleeping a fixed interval", () => {
    expect(updateScript).toContain("Wait-ForHealthyWorkerTree");
    expect(updateScript).not.toMatch(/Start-Sleep -Seconds 5\s*\r?\n\s*#?\s*health/i);
  });

  it("never reads, writes or passes worker credentials", () => {
    expect(updateScript).not.toMatch(/\bWORKER_TOKEN\s*=/);
    expect(updateScript).not.toMatch(/Get-Content.*worker-credentials\.json/);
  });

  it("never rewrites .env", () => {
    expect(updateScript).not.toMatch(/Set-Content[^\r\n]*\.env\b/);
    expect(updateScript).not.toMatch(/Out-File[^\r\n]*\.env\b/);
  });

  it("documents that diagnostics accept no shell command and no caller-supplied path", () => {
    expect(updateScript).toContain("No shell access of any kind");
    expect(updateScript).toContain("confined to C:\\DYO-Agent");
  });

  it("documents that the safe restart never creates a second worker or identity", () => {
    expect(updateScript).toMatch(/never a second Worker, never a second supervisor/);
  });

  it("has a double-clickable launcher pointing at this exact script", () => {
    expect(updateBat).toContain("DYO-Worker-RemoteDiagnostics-Update.ps1");
    expect(updateBat).toContain("-ExecutionPolicy Bypass");
  });

  it("does not still reference the previous release's launcher name", () => {
    expect(updateScript).not.toContain("DYO-Worker-StartupRecovery-Update.bat");
  });
});
