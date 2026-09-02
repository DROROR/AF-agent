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
