import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const recoverScript = readFileSync(join(deployDir, "DYO-Worker-Recover.ps1"), "utf8");
const recoverBat = readFileSync(join(deployDir, "DYO-Worker-Recover.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN in prose. "Never appears in the code" assertions
// below check only the executable body.
const recoverCodeBody = recoverScript.slice(recoverScript.indexOf("#>") + 2);

/**
 * DYO-Worker-Recover.ps1/.bat is the standalone one-click recovery launcher
 * (hardening follow-up to DYO-Worker-Final-Update.ps1's own automatic
 * rollback): restores the most recent worker-app-pre-update-* backup
 * without asking for a registration code or changing any
 * credentials/configuration. These tests assert it never re-registers,
 * never touches .env/credentials, always finds the MOST RECENT backup, and
 * never claims success without an independently verified fresh heartbeat.
 */
describe("DYO-Worker-Recover.ps1 never registers a new worker identity", () => {
  it("STOPs with a clear message and exits nonzero if worker-credentials.json is missing, instead of silently registering", () => {
    const credCheckIndex = recoverScript.indexOf("$credentialsPath = Join-Path $WorkRoot");
    expect(credCheckIndex, "credentials existence check not found").toBeGreaterThan(-1);
    const block = recoverScript.slice(credCheckIndex, credCheckIndex + 400);
    expect(block).toMatch(/if \(-not \(Test-Path \$credentialsPath\)\)/);
    expect(block).toMatch(/exit 1/);
  });

  it("never opens, reads, or parses worker-credentials.json - only checks that it exists", () => {
    expect(recoverScript).not.toMatch(/Get-Content[^\n]*worker-credentials/);
  });

  it("never prompts for anything - no Read-Host anywhere", () => {
    expect(recoverScript).not.toMatch(/Read-Host/);
  });

  it("never references WORKER_ID, WORKER_TOKEN, or a registration secret in its executable body", () => {
    expect(recoverCodeBody).not.toMatch(/WORKER_ID/);
    expect(recoverCodeBody).not.toMatch(/WORKER_TOKEN/);
    expect(recoverCodeBody).not.toMatch(/WORKER_REGISTRATION_SECRET/);
    expect(recoverCodeBody).not.toMatch(/registerWorker/);
  });
});

describe("DYO-Worker-Recover.ps1 never modifies .env, never touches any After Effects project", () => {
  it("excludes .env from the restore copy", () => {
    expect(recoverScript).toMatch(
      /Copy-Item -Path \(Join-Path \$BackupDir "\*"\) -Destination \$InstallDir -Recurse -Force -Exclude "\.env"/
    );
  });

  it("never writes to, rewrites, or deletes the .env file", () => {
    expect(recoverScript).not.toMatch(/Set-Content[^\n]*\.env/);
    expect(recoverScript).not.toMatch(/Remove-Item[^\n]*\.env\b/);
  });

  it("never opens, reads, or references any After Effects project path", () => {
    expect(recoverCodeBody).not.toMatch(/\.aep\b/i);
  });

  it("never invokes ae-mcp/node/aerender directly, and never calls any capability itself", () => {
    const executableLines = recoverCodeBody
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    expect(executableLines).not.toMatch(/&\s*node\b/);
    expect(executableLines).not.toMatch(/&\s*aerender/i);
    expect(executableLines).not.toMatch(/callTool/);
    expect(executableLines).not.toMatch(/HeroicSwanMcpClient/);
    expect(executableLines).not.toMatch(/HeroicSwanTemplateInspector/);
  });
});

describe("DYO-Worker-Recover.ps1 finds the MOST RECENT backup, never an arbitrary or oldest one", () => {
  it("looks under WorkRoot\\backups for worker-app-pre-update-* folders, the exact convention DYO-Worker-Final-Update.ps1 creates", () => {
    expect(recoverScript).toMatch(/\$BackupRoot = Join-Path \$WorkRoot "backups"/);
    expect(recoverScript).toMatch(/-Filter "worker-app-pre-update-\*"/);
  });

  it("sorts by name descending and takes only the first - timestamped folder names sort correctly as the most recent first", () => {
    const idx = recoverScript.indexOf("$latestBackup = Get-ChildItem");
    expect(idx).toBeGreaterThan(-1);
    const block = recoverScript.slice(idx, idx + 300);
    expect(block).toMatch(/Sort-Object Name -Descending/);
    expect(block).toMatch(/Select-Object -First 1/);
  });

  it("refuses to proceed (exits nonzero) if no backup exists at all", () => {
    const idx = recoverScript.indexOf("if (-not $latestBackup) {");
    expect(idx).toBeGreaterThan(-1);
    const block = recoverScript.slice(idx, idx + 300);
    expect(block).toMatch(/exit 1/);
  });

  it("independently verifies the chosen backup is non-empty (contains dist\\index.js) before restoring from it", () => {
    const idx = recoverScript.indexOf('if (-not (Test-Path (Join-Path $BackupDir "dist\\index.js")))');
    expect(idx).toBeGreaterThan(-1);
    const block = recoverScript.slice(idx, idx + 300);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/incomplete backup/i);
  });
});

describe("DYO-Worker-Recover.ps1 sets/clears the maintenance flag so the supervisor never fights this recovery", () => {
  it("defines $MaintenanceFlagPath under WorkRoot\\state, the exact path apps/worker/src/supervisor/maintenance-flag.ts checks", () => {
    expect(recoverScript).toMatch(/\$MaintenanceFlagPath = Join-Path \$WorkRoot "state\\maintenance\.flag"/);
  });

  it("sets the flag BEFORE stopping the current process, clears it BEFORE restarting - same discipline as the updater/rollback", () => {
    const setIdx = recoverScript.indexOf("Set-Content -Path $MaintenanceFlagPath");
    const stopIdx = recoverScript.indexOf("Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue");
    const restoreIdx = recoverScript.indexOf('Copy-Item -Path (Join-Path $BackupDir "*")');
    const clearIdx = recoverScript.lastIndexOf("Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue");
    const startIdx = recoverScript.lastIndexOf("Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue");
    expect(setIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(setIdx);
    expect(restoreIdx).toBeGreaterThan(stopIdx);
    expect(clearIdx).toBeGreaterThan(restoreIdx);
    expect(startIdx).toBeGreaterThan(clearIdx);
  });

  it("a failed restore clears the maintenance flag before exiting, rather than leaving it stuck", () => {
    const idx = recoverScript.indexOf("[NEEDS ATTENTION] Restoring the backup failed");
    expect(idx).toBeGreaterThan(-1);
    const block = recoverScript.slice(idx, idx + 400);
    expect(block).toMatch(/Remove-Item -Path \$MaintenanceFlagPath -Force -ErrorAction SilentlyContinue/);
    expect(block).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-Recover.ps1 never claims success without an independently verified fresh heartbeat", () => {
  it("waits for a real heartbeat from the restored process before reporting anything", () => {
    expect(recoverScript).toMatch(/\$heartbeatOk = Wait-Until/);
    expect(recoverScript).toMatch(/"msg":"heartbeat succeeded"/);
  });

  it("RECOVERY SUCCEEDED requires both the process running AND a real heartbeat, never one alone", () => {
    const idx = recoverScript.indexOf("if ($processRunning -and $heartbeatOk) {");
    expect(idx).toBeGreaterThan(-1);
    const block = recoverScript.slice(idx, idx + 300);
    expect(block).toMatch(/RECOVERY SUCCEEDED/);
  });

  it("RECOVERY FAILED path tells the client not to assume the worker is running and to contact DYO, never silently exits clean", () => {
    const idx = recoverScript.indexOf("RECOVERY FAILED");
    expect(idx).toBeGreaterThan(-1);
    const block = recoverScript.slice(idx, idx + 400);
    expect(block).toMatch(/DO NOT ASSUME DYO WORKER IS RUNNING/);
    expect(block).toMatch(/exit 1/);
  });

  it("exits 0 only on the verified-success path", () => {
    const successIdx = recoverScript.indexOf("RECOVERY SUCCEEDED");
    const failIdx = recoverScript.indexOf("RECOVERY FAILED");
    expect(successIdx).toBeGreaterThan(-1);
    expect(failIdx).toBeGreaterThan(successIdx);
    expect(recoverScript.slice(successIdx, failIdx)).toMatch(/exit 0/);
  });
});

describe("DYO-Worker-Recover.ps1 is fully self-contained, same convention as every other Windows-worker script", () => {
  it("defines its own copies of the shared helper functions rather than dot-sourcing another script", () => {
    expect(recoverScript).toMatch(/function Write-CheckResult/);
    expect(recoverScript).toMatch(/function Test-IsDyoWorkerCommandLine/);
    expect(recoverScript).toMatch(/function Get-DyoWorkerProcesses/);
    expect(recoverScript).toMatch(/function Wait-Until/);
    expect(recoverScript).toMatch(/function Get-FreshLogContent/);
    expect(recoverScript).not.toMatch(/\.\s+["'].*\.ps1["']/);
  });

  it("only ever targets the exact worker process signature, never a blanket node.exe kill", () => {
    expect(recoverScript).toMatch(/Stop-Process -Id \$_\.ProcessId -Force/);
    expect(recoverScript).not.toMatch(/taskkill/i);
  });
});

describe("DYO-Worker-Recover.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-Recover.ps1 without asking for any input itself", () => {
    expect(recoverBat).toMatch(/DYO-Worker-Recover\.ps1/);
    expect(recoverBat).not.toMatch(/set \/p/i);
  });
});

/**
 * P4/P5 (2026-09-04 stuck-job recovery, regression test #11): the recovery
 * script now also confirms this computer's own ae-mcp bridge process is
 * stopped (never After Effects itself) before restarting DYO Worker, so a
 * job that was stuck when this script runs cannot keep executing invisibly
 * after Worker restarts. These tests prove that addition stays scoped
 * exactly the same way the existing worker-process matching already is:
 * one exact command-line signature, never a blanket kill, never touching
 * credentials/.env/AfterFX itself.
 */
describe("DYO-Worker-Recover.ps1 terminates only this computer's own leftover ae-mcp process, never After Effects or an unrelated process", () => {
  it("reads AE_MCP_PATH from this computer's own .env, never hardcodes or guesses a path", () => {
    expect(recoverScript).toMatch(/function Get-DyoConfiguredAeMcpPath/);
    const idx = recoverScript.indexOf("function Get-DyoConfiguredAeMcpPath");
    const block = recoverScript.slice(idx, idx + 700);
    expect(block).toMatch(/AE_MCP_PATH/);
    expect(block).toMatch(/Join-Path \$InstallDir "\.env"/);
  });

  it("matches an ae-mcp process only by BOTH its exact configured dist\\index.js path AND the serve subcommand - never the worker's own entrypoint pattern", () => {
    expect(recoverScript).toMatch(/function Test-IsDyoAeMcpCommandLine/);
    const idx = recoverScript.indexOf("function Test-IsDyoAeMcpCommandLine");
    const block = recoverScript.slice(idx, idx + 600);
    expect(block).toMatch(/\[regex\]::Escape/);
    expect(block).toMatch(/dist\\index\.js/);
    expect(block).toMatch(/serve/);
    // Never reuses (or matches the same pattern as) the worker's own
    // entrypoint matcher - these must stay two distinct signatures so a
    // Worker process is never mistaken for an ae-mcp process or vice versa.
    expect(block).not.toMatch(/WorkerEntrypointPattern/);
    expect(block).not.toMatch(/WorkerEnvArgPattern/);
  });

  it("only ever targets ae-mcp processes discovered via Get-DyoAeMcpProcesses (PID-scoped Stop-Process), never a blanket taskkill or Stop-Process by name", () => {
    const idx = recoverScript.indexOf("function Get-DyoAeMcpProcesses");
    expect(idx).toBeGreaterThan(-1);
    const stopBlockIdx = recoverScript.indexOf("Checking for a leftover ae-mcp process");
    expect(stopBlockIdx).toBeGreaterThan(-1);
    const block = recoverScript.slice(stopBlockIdx, stopBlockIdx + 1500);
    expect(block).toMatch(/Stop-Process -Id \$_\.ProcessId -Force/);
    expect(block).not.toMatch(/taskkill/i);
    expect(block).not.toMatch(/Stop-Process -Name/);
  });

  it("never references AfterFX, aerender, or opening/saving a project anywhere in the ae-mcp termination block", () => {
    const stopBlockIdx = recoverScript.indexOf("Checking for a leftover ae-mcp process");
    const nextSectionIdx = recoverScript.indexOf("Restore the backup", stopBlockIdx);
    const block = recoverScript.slice(stopBlockIdx, nextSectionIdx);
    expect(block).not.toMatch(/AfterFX/i);
    expect(block).not.toMatch(/aerender/i);
    expect(block).not.toMatch(/\.aep/i);
    expect(block).not.toMatch(/\.save\(/);
  });

  it("refuses to continue (exits nonzero, clears the maintenance flag) rather than restarting DYO Worker if a leftover ae-mcp process could not be confirmed stopped", () => {
    const idx = recoverScript.indexOf("Could not confirm ae-mcp process(es)");
    expect(idx).toBeGreaterThan(-1);
    const block = recoverScript.slice(idx, idx + 900);
    expect(block).toMatch(/Remove-Item -Path \$MaintenanceFlagPath -Force -ErrorAction SilentlyContinue/);
    expect(block).toMatch(/exit 1/);
    // This refusal must come BEFORE the backup is restored / worker restarted.
    const restoreIdx = recoverScript.indexOf('Write-Host "Restoring program files from backup..."');
    expect(idx).toBeLessThan(restoreIdx);
  });

  it("proceeds normally (no exit) when no AE_MCP_PATH is configured or no leftover process is found", () => {
    expect(recoverScript).toMatch(/No AE_MCP_PATH configured in \.env - nothing to check/);
    expect(recoverScript).toMatch(/No leftover ae-mcp process found/);
  });

  it("this whole block never touches worker-credentials.json or .env writes, same guarantee as the rest of the script", () => {
    const stopBlockIdx = recoverScript.indexOf("Checking for a leftover ae-mcp process");
    const nextSectionIdx = recoverScript.indexOf("Restore the backup", stopBlockIdx);
    const block = recoverScript.slice(stopBlockIdx, nextSectionIdx);
    expect(block).not.toMatch(/worker-credentials/);
    expect(block).not.toMatch(/Set-Content[^\n]*\.env/);
  });
});
