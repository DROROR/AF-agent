import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-CheckHealth-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-CheckHealth-Update.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN/CHECK_HEALTH in prose. "Never appears in the
// code" assertions below check only the executable body.
const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

describe("DYO-Worker-CheckHealth-Update.ps1 never registers a new worker identity", () => {
  it("STOPs with a clear message and exits nonzero if worker-credentials.json is missing, instead of silently registering", () => {
    const credCheckIndex = updateScript.indexOf("$credentialsPath = Join-Path $WorkRoot");
    expect(credCheckIndex, "credentials existence check not found").toBeGreaterThan(-1);
    const block = updateScript.slice(credCheckIndex, credCheckIndex + 700);
    expect(block).toMatch(/if \(-not \(Test-Path \$credentialsPath\)\)/);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/never registers/i);
  });

  it("never opens, reads, or parses worker-credentials.json - only checks that it exists", () => {
    expect(updateScript).not.toMatch(/Get-Content[^\n]*worker-credentials/);
    expect(updateScript).not.toMatch(/ConvertFrom-Json/);
  });

  it("never prompts for anything - no Read-Host anywhere", () => {
    expect(updateScript).not.toMatch(/Read-Host/);
  });

  it("never references WORKER_ID, WORKER_TOKEN, or a registration secret in its executable body", () => {
    expect(updateCodeBody).not.toMatch(/WORKER_ID/);
    expect(updateCodeBody).not.toMatch(/WORKER_TOKEN/);
    expect(updateCodeBody).not.toMatch(/WORKER_REGISTRATION_SECRET/);
    expect(updateCodeBody).not.toMatch(/registerWorker/);
  });

  it("requires InstallDir to already exist - refuses to run as a substitute for first-time setup", () => {
    const checkIndex = updateScript.indexOf("if (-not (Test-Path $InstallDir))");
    expect(checkIndex).toBeGreaterThan(-1);
    const block = updateScript.slice(checkIndex, checkIndex + 400);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/DYO-Worker-Setup\.bat/);
  });

  it("STOPs with a clear message if the Scheduled Task does not exist, rather than silently creating one", () => {
    const idx = updateScript.indexOf("if (-not $task)");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 300);
    expect(block).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-CheckHealth-Update.ps1 never modifies .env, never touches ae-mcp/AE at all", () => {
  it("never writes to, rewrites, or deletes the .env file - only checks it exists", () => {
    expect(updateScript).not.toMatch(/Set-Content[^\n]*\$envPath/);
    expect(updateScript).not.toMatch(/Remove-Item[^\n]*\$envPath/);
    expect(updateScript).toMatch(/if \(-not \(Test-Path \$envPath\)\)/);
  });

  it("excludes .env from the bulk program-file copy", () => {
    expect(updateScript).toMatch(
      /Copy-Item -Path \(Join-Path \$sourceApp "\*"\) -Destination \$InstallDir -Recurse -Force -Exclude "\.env"/
    );
  });

  it("never invokes ae-mcp/node directly, and never calls CHECK_HEALTH/INSPECT_TEMPLATE itself - it only installs the capability", () => {
    const executableLines = updateCodeBody
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    expect(executableLines).not.toMatch(/&\s*node\b/);
    expect(executableLines).not.toMatch(/callTool/);
    expect(executableLines).not.toMatch(/HeroicSwanMcpClient/);
    expect(executableLines).not.toMatch(/HeroicSwanTemplateInspector/);
    expect(executableLines).not.toMatch(/runCheckHealthDiagnostics/);
    // "CHECK_HEALTH"/"INSPECT_TEMPLATE" DO legitimately appear as log-content
    // search strings (verifying the NEW process advertises them) - this
    // asserts they are only ever used inside the verification match
    // expressions, never as an executed job/operation dispatch.
    expect(executableLines).not.toMatch(/operation["']?\s*[:=]\s*["']CHECK_HEALTH/);
    expect(executableLines).not.toMatch(/dispatchJob|POST.*\/api\/jobs/);
  });

  it("never opens, reads, or references any After Effects project path", () => {
    expect(updateCodeBody).not.toMatch(/\.aep\b/i);
  });
});

describe("DYO-Worker-CheckHealth-Update.ps1 fixes the IgnoreNew restart race with real verification", () => {
  it("defines a process check scoped to node.exe processes matching this exact install directory - never a blanket kill", () => {
    expect(updateScript).toMatch(/function Get-DyoWorkerProcesses/);
    expect(updateScript).toMatch(/Name = 'node\.exe'/);
    expect(updateScript).toMatch(/CommandLine\.ToLowerInvariant\(\)\.Contains\(\$needle\)/);
  });

  it("waits and re-verifies both task state AND real process count before considering the worker stopped", () => {
    const idx = updateScript.indexOf("$stopped = Wait-Until");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 300);
    expect(block).toMatch(/State -ne "Running"/);
    expect(block).toMatch(/procs\.Count -eq 0/);
  });

  it("escalates to a scoped Stop-Process only on the matched processes if the graceful stop does not land in time", () => {
    expect(updateScript).toMatch(/Stop-Process -Id \$_\.ProcessId -Force/);
  });

  it("refuses to proceed (does not copy files) if stop could not be verified", () => {
    // Two "if (-not $stopped)" blocks exist (the escalation attempt, then
    // the hard-fail check) - this targets the second, which is where
    // "No program files were changed"/exit 1 actually live.
    const idx = updateScript.lastIndexOf("if (-not $stopped) {");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 500);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/No program files were changed/);
  });

  it("verifies a NEW real process exists after restart before checking for a heartbeat", () => {
    expect(updateScript).toMatch(/\$started = Wait-Until/);
    expect(updateScript).toMatch(/procs\.Count -gt 0|\(Get-DyoWorkerProcesses -Dir \$InstallDir\)\.Count -gt 0/);
  });

  it("verifies a real NEW successful heartbeat (not just a running process) by reading only log content appended after the restart", () => {
    expect(updateScript).toMatch(/\$logLengthBeforeRestart/);
    expect(updateScript).toMatch(/heartbeat succeeded/);
    expect(updateScript).toMatch(/function Get-NewLogContent/);
  });

  it("verifies CHECK_HEALTH and INSPECT_TEMPLATE both appear in the new process's own startup log line, and STOPs (never prints success) if not", () => {
    const idx = updateScript.indexOf('$newContent -match \'"msg":"worker starting"\'');
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 700);
    expect(block).toMatch(/CHECK_HEALTH/);
    expect(block).toMatch(/INSPECT_TEMPLATE/);
    expect(block).toMatch(/exit 1/);
  });

  it("never prints \"Update complete\" before every verification step above has already passed", () => {
    const completeIdx = updateScript.indexOf("Update complete");
    const heartbeatCheckIdx = updateScript.indexOf("$heartbeatOk = Wait-Until");
    const capabilityCheckIdx = updateScript.indexOf('$newContent -match \'"msg":"worker starting"\'');
    expect(completeIdx).toBeGreaterThan(heartbeatCheckIdx);
    expect(completeIdx).toBeGreaterThan(capabilityCheckIdx);
  });
});

describe("DYO-Worker-CheckHealth-Update.ps1 restarts (not re-registers) the existing Scheduled Task", () => {
  it("uses the exact TaskName \"DYO Video Worker\"", () => {
    expect(updateScript).toMatch(/\$TaskName = "DYO Video Worker"/);
  });

  it("stops the task if running, then starts it again, rather than re-registering it", () => {
    expect(updateScript).not.toMatch(/Register-ScheduledTask/);
    expect(updateScript).not.toMatch(/Unregister-ScheduledTask/);
    expect(updateScript).toMatch(/Stop-ScheduledTask -TaskName \$TaskName/);
    expect(updateScript).toMatch(/Start-ScheduledTask -TaskName \$TaskName/);
  });
});

describe("DYO-Worker-CheckHealth-Update.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-CheckHealth-Update.ps1 without asking for any input itself", () => {
    expect(updateBat).toMatch(/DYO-Worker-CheckHealth-Update\.ps1/);
    expect(updateBat).not.toMatch(/set \/p/i);
  });
});
