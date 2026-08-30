import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const selfTestScript = readFileSync(join(deployDir, "DYO-Worker-Lifecycle-SelfTest.ps1"), "utf8");
const selfTestBat = readFileSync(join(deployDir, "DYO-Worker-Lifecycle-SelfTest.bat"), "utf8");
const updateScript = readFileSync(join(deployDir, "DYO-Worker-Final-Update.ps1"), "utf8");

const selfTestCodeBody = selfTestScript.slice(selfTestScript.indexOf("#>") + 2);

/** Same extraction approach as dyo-worker-final-update.test.ts's own extractPattern - re-applies the script's real regex source as a real JS RegExp. */
function extractPattern(script: string, varName: string): RegExp {
  const match = new RegExp(`\\$${varName}\\s*=\\s*'([^']+)'`).exec(script);
  if (!match?.[1]) {
    throw new Error(`could not find $${varName} in the script`);
  }
  return new RegExp(match[1]);
}

function isDyoWorkerCommandLine(commandLine: string): boolean {
  const entrypoint = extractPattern(selfTestScript, "WorkerEntrypointPattern");
  const envArg = extractPattern(selfTestScript, "WorkerEnvArgPattern");
  return entrypoint.test(commandLine) && envArg.test(commandLine);
}

describe("DYO-Worker-Lifecycle-SelfTest.ps1 process matcher - identical to DYO-Worker-Final-Update.ps1's own, never a diverged duplicate", () => {
  it("uses the EXACT SAME pattern source as the updater - both scripts must move together, never silently diverge", () => {
    const selfTestEntrypoint = extractPattern(selfTestScript, "WorkerEntrypointPattern").source;
    const selfTestEnvArg = extractPattern(selfTestScript, "WorkerEnvArgPattern").source;
    const updateEntrypoint = extractPattern(updateScript, "WorkerEntrypointPattern").source;
    const updateEnvArg = extractPattern(updateScript, "WorkerEnvArgPattern").source;
    expect(selfTestEntrypoint).toBe(updateEntrypoint);
    expect(selfTestEnvArg).toBe(updateEnvArg);
  });

  it("matches both backslash and forward-slash forms of the real worker invocation - real production bug, 2026-08-30", () => {
    expect(isDyoWorkerCommandLine("node --env-file=.env dist\\index.js")).toBe(true);
    expect(isDyoWorkerCommandLine("node --env-file=.env dist/index.js")).toBe(true);
  });

  it("never matches the supervisor's own process, either separator style", () => {
    expect(isDyoWorkerCommandLine("node dist\\supervisor\\index.js")).toBe(false);
    expect(isDyoWorkerCommandLine("node dist/supervisor/index.js")).toBe(false);
  });

  it("never matches an ae-mcp-shaped command line (same entry-point name, no --env-file)", () => {
    expect(isDyoWorkerCommandLine('node "C:\\Program Files\\ae-mcp\\dist\\index.js" serve')).toBe(false);
  });

  it("never matches an unrelated Node application, even one also using --env-file", () => {
    expect(isDyoWorkerCommandLine("node --env-file=.env server.js")).toBe(false);
  });
});

describe("DYO-Worker-Lifecycle-SelfTest.ps1 refuses to run destructively when a job might be active", () => {
  it("checks for an in-progress job BEFORE terminating anything", () => {
    const checkIdx = selfTestScript.indexOf("Test-DyoJobMightBeActive -LogContent $logBefore");
    const killIdx = selfTestScript.indexOf("Stop-Process -Id $oldPid -Force");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(killIdx).toBeGreaterThan(checkIdx);
  });

  it("exits nonzero and never proceeds when a job appears active", () => {
    const idx = selfTestScript.indexOf("if (Test-DyoJobMightBeActive -LogContent $logBefore) {");
    expect(idx).toBeGreaterThan(-1);
    const block = selfTestScript.slice(idx, idx + 400);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/Skipping this destructive test/i);
  });

  it("Test-DyoJobMightBeActive matches a claimed job with no completion after it, and clears once completed/failed", () => {
    const idx = selfTestScript.indexOf("function Test-DyoJobMightBeActive");
    expect(idx).toBeGreaterThan(-1);
    const block = selfTestScript.slice(idx, idx + 900);
    expect(block).toMatch(/"msg":"job claimed"/);
    expect(block).toMatch(/"msg":"job completed"/);
    expect(block).toMatch(/"msg":"job cycle failed"/);
  });
});

describe("DYO-Worker-Lifecycle-SelfTest.ps1 only ever terminates the ONE current worker process", () => {
  it("resolves exactly one target PID from Get-DyoWorkerProcesses before terminating anything", () => {
    const idx = selfTestScript.indexOf("$oldProcs = @(Get-DyoWorkerProcesses)");
    expect(idx).toBeGreaterThan(-1);
    const block = selfTestScript.slice(idx, idx + 500);
    expect(block).toMatch(/\$oldPid = \(\$oldProcs \| Select-Object -First 1 -ExpandProperty ProcessId\)/);
  });

  it("terminates only that exact PID, never a blanket node.exe kill and never taskkill", () => {
    expect(selfTestScript).toMatch(/Stop-Process -Id \$oldPid -Force -ErrorAction Stop/);
    expect(selfTestScript).not.toMatch(/taskkill/i);
    expect(selfTestScript).not.toMatch(/Stop-Process[^\n]*-Name/);
  });

  it("never calls Stop-ScheduledTask, Unregister-ScheduledTask, or touches the task definition itself", () => {
    expect(selfTestScript).not.toMatch(/Stop-ScheduledTask/);
    expect(selfTestScript).not.toMatch(/Unregister-ScheduledTask/);
    expect(selfTestScript).not.toMatch(/Register-ScheduledTask/);
  });

  it("never references aerender, After Effects, or an .aep path", () => {
    expect(selfTestScript).not.toMatch(/aerender/i);
    expect(selfTestScript).not.toMatch(/\.aep\b/i);
    expect(selfTestScript).not.toMatch(/AfterFX/i);
  });
});

describe("DYO-Worker-Lifecycle-SelfTest.ps1 proves a genuinely NEW pid and a fresh heartbeat before ever reporting PASS", () => {
  it("waits for a pid different from the one it terminated", () => {
    const idx = selfTestScript.indexOf("$newPidFound = Wait-Until");
    expect(idx).toBeGreaterThan(-1);
    const block = selfTestScript.slice(idx, idx + 300);
    expect(block).toMatch(/\$_\.ProcessId -ne \$oldPid/);
  });

  it("waits for heartbeat content appended strictly AFTER the pre-kill log snapshot, never matching stale content", () => {
    const idx = selfTestScript.indexOf("$freshHeartbeat = Wait-Until");
    expect(idx).toBeGreaterThan(-1);
    const block = selfTestScript.slice(idx, idx + 400);
    expect(block).toMatch(/\$current\.Length -gt \$logBefore\.Length/);
    expect(block).toMatch(/\$current\.Substring\(\$logBefore\.Length\)/);
  });

  it("verifies worker-credentials.json is byte-for-byte unchanged - proof this was a restart, never a re-registration", () => {
    expect(selfTestScript).toMatch(/\$credentialsBefore = Get-Content -Path \$credentialsPath -Raw/);
    expect(selfTestScript).toMatch(/\$credentialsAfter = Get-Content -Path \$credentialsPath -Raw/);
    const idx = selfTestScript.indexOf("if ($credentialsAfter -ne $credentialsBefore) {");
    expect(idx).toBeGreaterThan(-1);
    const block = selfTestScript.slice(idx, idx + 300);
    expect(block).toMatch(/exit 1/);
  });

  it("never prints PASS before the new-pid check, the fresh-heartbeat check, AND the identity check have all already passed", () => {
    const passIdx = selfTestScript.indexOf("Lifecycle self-test: PASS");
    const newPidCheckIdx = selfTestScript.indexOf("$newPidFound = Wait-Until");
    const heartbeatCheckIdx = selfTestScript.indexOf("$freshHeartbeat = Wait-Until");
    const identityCheckIdx = selfTestScript.indexOf("if ($credentialsAfter -ne $credentialsBefore)");
    expect(passIdx).toBeGreaterThan(newPidCheckIdx);
    expect(passIdx).toBeGreaterThan(heartbeatCheckIdx);
    expect(passIdx).toBeGreaterThan(identityCheckIdx);
  });
});

describe("DYO-Worker-Lifecycle-SelfTest.ps1 never leaves the worker stopped, even on its own failure", () => {
  it("falls back to Start-ScheduledTask if the supervisor does not produce a new pid within the timeout", () => {
    const idx = selfTestScript.indexOf("if (-not $newPidFound) {");
    expect(idx).toBeGreaterThan(-1);
    const block = selfTestScript.slice(idx, idx + 500);
    expect(block).toMatch(/Start-ScheduledTask -TaskName \$TaskName -ErrorAction SilentlyContinue/);
  });

  it("reports FAIL (not a false PASS) when recovery only happened via the fallback, never silently treating the fallback as success", () => {
    expect(selfTestScript).toMatch(/\$restartedFallback = \$true/);
    const idx = selfTestScript.indexOf("if ($restartedFallback) {");
    expect(idx).toBeGreaterThan(-1);
  });
});

describe("DYO-Worker-Lifecycle-SelfTest.ps1 identity/safety", () => {
  it("never references WORKER_ID, WORKER_TOKEN, or a registration secret in its executable body", () => {
    expect(selfTestCodeBody).not.toMatch(/WORKER_ID/);
    expect(selfTestCodeBody).not.toMatch(/WORKER_TOKEN/);
    expect(selfTestCodeBody).not.toMatch(/WORKER_REGISTRATION_SECRET/);
  });

  it("never prompts for anything - no Read-Host anywhere", () => {
    expect(selfTestScript).not.toMatch(/Read-Host/);
  });

  it("refuses to run when no worker-credentials.json exists, rather than assuming a default identity", () => {
    const idx = selfTestScript.indexOf("if (-not (Test-Path $credentialsPath)) {");
    expect(idx).toBeGreaterThan(-1);
    const block = selfTestScript.slice(idx, idx + 300);
    expect(block).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-Lifecycle-SelfTest.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-Lifecycle-SelfTest.ps1 without asking for any input itself", () => {
    expect(selfTestBat).toMatch(/DYO-Worker-Lifecycle-SelfTest\.ps1/);
    expect(selfTestBat).not.toMatch(/set \/p/i);
  });
});
