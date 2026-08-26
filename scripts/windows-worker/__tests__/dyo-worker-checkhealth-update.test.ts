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

/**
 * Extracts the exact regex source PowerShell uses for
 * $WorkerEntrypointPattern/$WorkerEnvArgPattern and re-applies them as
 * real JS RegExp objects against realistic sample Windows command lines -
 * genuinely exercising the same matching semantics the .ps1 script uses
 * (both are plain literal-with-escaped-backslash/dot patterns, valid
 * identically in .NET and JS regex), not just asserting the pattern
 * exists somewhere in the source text.
 */
function extractPattern(script: string, varName: string): RegExp {
  const match = new RegExp(`\\$${varName}\\s*=\\s*'([^']+)'`).exec(script);
  if (!match?.[1]) {
    throw new Error(`could not find $${varName} in the script`);
  }
  return new RegExp(match[1]);
}

function isDyoWorkerCommandLine(commandLine: string): boolean {
  const entrypoint = extractPattern(updateScript, "WorkerEntrypointPattern");
  const envArg = extractPattern(updateScript, "WorkerEnvArgPattern");
  return entrypoint.test(commandLine) && envArg.test(commandLine);
}

describe("DYO-Worker-CheckHealth-Update.ps1 process matcher - the confirmed bug cannot return", () => {
  it("matches the real relative worker invocation run-worker.bat actually uses", () => {
    expect(isDyoWorkerCommandLine("node --env-file=.env dist\\index.js")).toBe(true);
  });

  it("matches the same invocation with node.exe's full resolved path prefixed", () => {
    expect(isDyoWorkerCommandLine('"C:\\Program Files\\nodejs\\node.exe" --env-file=.env dist\\index.js')).toBe(true);
  });

  it("never matches by install-directory substring alone - the confirmed root cause of two failed real updates", () => {
    // Exactly the fixture that broke the old implementation: a command
    // line that contains the install directory but NOT the worker's own
    // entrypoint/env-arg signature.
    expect(isDyoWorkerCommandLine("C:\\DYO-Agent\\app\\some-other-tool.exe --doing something")).toBe(false);
  });

  it("rejects an unrelated Node application, even one also using --env-file", () => {
    expect(isDyoWorkerCommandLine("node --env-file=.env server.js")).toBe(false);
  });

  it("rejects a Node app with a similarly-named but different entrypoint (no literal dist\\index.js)", () => {
    expect(isDyoWorkerCommandLine("node --env-file=.env other-app\\index.js")).toBe(false);
  });

  it("rejects a plain node.exe with no arguments at all", () => {
    expect(isDyoWorkerCommandLine("node.exe")).toBe(false);
  });

  it("rejects an empty/null command line rather than throwing", () => {
    expect(isDyoWorkerCommandLine("")).toBe(false);
  });

  it("the script's own matcher function requires BOTH the entrypoint and the env-arg pattern (a single substring alone is not a safe enough signature)", () => {
    const idx = updateScript.indexOf("function Test-IsDyoWorkerCommandLine");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/-match \$WorkerEntrypointPattern/);
    expect(block).toMatch(/-match \$WorkerEnvArgPattern/);
    expect(block).toMatch(/-and/);
  });

  it("Get-DyoWorkerProcesses no longer takes or uses an InstallDir parameter for matching", () => {
    const idx = updateScript.indexOf("function Get-DyoWorkerProcesses");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 300);
    expect(block).not.toMatch(/\$Dir\b/);
    expect(block).not.toMatch(/\$InstallDir/);
    expect(block).toMatch(/Test-IsDyoWorkerCommandLine/);
  });
});

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
    expect(executableLines).not.toMatch(/operation["']?\s*[:=]\s*["']CHECK_HEALTH/);
    expect(executableLines).not.toMatch(/dispatchJob|POST.*\/api\/jobs/);
  });

  it("never opens, reads, or references any After Effects project path", () => {
    expect(updateCodeBody).not.toMatch(/\.aep\b/i);
  });
});

describe("DYO-Worker-CheckHealth-Update.ps1 fixes the IgnoreNew restart race with real PID-based verification", () => {
  it("records the OLD process PIDs before stopping, so 'new process' can mean something real later", () => {
    const idx = updateScript.indexOf("$oldPids = @(");
    expect(idx).toBeGreaterThan(-1);
    // Must be captured before Stop-ScheduledTask is ever called.
    const stopIdx = updateScript.indexOf("Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue");
    expect(stopIdx).toBeGreaterThan(idx);
  });

  it("waits and re-verifies both task state AND real process count before considering the worker stopped", () => {
    const idx = updateScript.indexOf("$stopped = Wait-Until");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 300);
    expect(block).toMatch(/State -ne "Running"/);
    expect(block).toMatch(/procs\.Count -eq 0/);
  });

  it("escalates to Stop-Process ONLY on the exact matched worker processes, never a blanket kill of node.exe", () => {
    expect(updateScript).toMatch(/Get-DyoWorkerProcesses \| ForEach-Object/);
    expect(updateScript).toMatch(/Stop-Process -Id \$_\.ProcessId -Force/);
    // Never a bare "Get-Process node" / "taskkill /IM node.exe" - both would
    // affect every Node process on the machine, not just this worker's.
    expect(updateScript).not.toMatch(/Get-Process\s+(-Name\s+)?["']?node["']?\s*(?!.*Test-IsDyoWorkerCommandLine)/);
    expect(updateScript).not.toMatch(/taskkill/i);
  });

  it("refuses to proceed (does not copy files) if stop could not be verified", () => {
    const idx = updateScript.lastIndexOf("if (-not $stopped) {");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 500);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/No program files were changed/);
  });

  it("requires a NEW pid that was never one of the old pids - a same/leftover PID does not count as started", () => {
    const idx = updateScript.indexOf("$started = Wait-Until");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/\$oldPids -notcontains \$_/);
  });

  it("proactively moves any existing worker.log aside before restarting, so stale content can never satisfy verification", () => {
    const idx = updateScript.indexOf("if (Test-Path $logPath) {");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 300);
    expect(block).toMatch(/Move-Item -Path \$logPath -Destination \$preUpdateBackup -Force/);
    // Must happen before Start-ScheduledTask, not after.
    const startIdx = updateScript.indexOf("Start-ScheduledTask -TaskName $TaskName", idx);
    expect(startIdx).toBeGreaterThan(idx);
  });

  it("reads the post-restart log fresh from the start (not a stale byte offset into a possibly-different file)", () => {
    expect(updateScript).toMatch(/function Get-FreshLogContent/);
    expect(updateScript).not.toMatch(/logLengthBeforeRestart/);
  });

  it("verifies a real new successful heartbeat before considering the update successful", () => {
    expect(updateScript).toMatch(/\$heartbeatOk = Wait-Until/);
    expect(updateScript).toMatch(/heartbeat succeeded/);
    const idx = updateScript.indexOf("if (-not $heartbeatOk)");
    expect(idx).toBeGreaterThan(-1);
    expect(updateScript.slice(idx, idx + 300)).toMatch(/exit 1/);
  });

  it("verifies CHECK_HEALTH and INSPECT_TEMPLATE both appear in the new process's own startup log line, and STOPs (never prints success) if not", () => {
    const idx = updateScript.indexOf('$newContent -match \'"msg":"worker starting"\'');
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 700);
    expect(block).toMatch(/CHECK_HEALTH/);
    expect(block).toMatch(/INSPECT_TEMPLATE/);
    expect(block).toMatch(/exit 1/);
  });

  it("requires a real BUILD_INFO commit marker in the new process's log line, and STOPs (never prints success) if missing", () => {
    const idx = updateScript.indexOf("$commitMatch = [regex]::Match");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 500);
    expect(block).toMatch(/if \(-not \$commitMatch\.Success\)/);
    expect(block).toMatch(/exit 1/);
  });

  it('never prints "Update complete" before every verification step above has already passed', () => {
    const completeIdx = updateScript.indexOf("Update complete");
    const heartbeatCheckIdx = updateScript.indexOf("$heartbeatOk = Wait-Until");
    const capabilityCheckIdx = updateScript.indexOf('$newContent -match \'"msg":"worker starting"\'');
    const buildInfoCheckIdx = updateScript.indexOf("$commitMatch = [regex]::Match");
    expect(completeIdx).toBeGreaterThan(heartbeatCheckIdx);
    expect(completeIdx).toBeGreaterThan(capabilityCheckIdx);
    expect(completeIdx).toBeGreaterThan(buildInfoCheckIdx);
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
