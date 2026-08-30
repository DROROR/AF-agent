import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-Final-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-Final-Update.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN/CHECK_HEALTH/aerender in prose. "Never appears in
// the code" assertions below check only the executable body.
const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

/**
 * Extracts the exact regex source PowerShell uses for
 * $WorkerEntrypointPattern/$WorkerEnvArgPattern and re-applies them as real
 * JS RegExp objects against realistic sample Windows command lines -
 * genuinely exercising the same matching semantics the .ps1 script uses,
 * not just asserting the pattern exists somewhere in the source text. Same
 * approach already proven in dyo-worker-checkhealth-update.test.ts.
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

/** Every file scripts/package-windows-worker.mjs actually produced for THIS exact packaged build - see BUILD_INFO.json alongside it. */
const REAL_PACKAGED_FILES = [
  "dist/execution/execute-scene-edit-executor.js",
  "dist/execution/scene-edit-checkpoint.js",
  "dist/execution/preview-capture.js",
  "dist/execution/render/render-project-executor.js",
  "dist/execution/render/aerender-runner.js",
  "dist/execution/render/inspect-render-capabilities.js",
  "dist/execution/render/upload-render-artifact.js",
  "dist/workspace/working-copy.js"
];

describe("DYO-Worker-Final-Update.ps1 process matcher - reuses the confirmed-safe CheckHealth-Update approach", () => {
  it("matches the real relative worker invocation run-worker.bat actually uses", () => {
    expect(isDyoWorkerCommandLine("node --env-file=.env dist\\index.js")).toBe(true);
  });

  it("matches the same invocation with node.exe's full resolved path prefixed", () => {
    expect(isDyoWorkerCommandLine('"C:\\Program Files\\nodejs\\node.exe" --env-file=.env dist\\index.js')).toBe(true);
  });

  it("never matches by install-directory substring alone", () => {
    expect(isDyoWorkerCommandLine("C:\\DYO-Agent\\app\\some-other-tool.exe --doing something")).toBe(false);
  });

  it("rejects an unrelated Node application, even one also using --env-file", () => {
    expect(isDyoWorkerCommandLine("node --env-file=.env server.js")).toBe(false);
  });

  it("rejects an empty/null command line rather than throwing", () => {
    expect(isDyoWorkerCommandLine("")).toBe(false);
  });
});

describe("DYO-Worker-Final-Update.ps1 never registers a new worker identity", () => {
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
});

describe("DYO-Worker-Final-Update.ps1 never modifies .env, never touches ae-mcp/AE/aerender at all", () => {
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

  it("never invokes ae-mcp/node/aerender directly, and never calls any capability itself - it only installs the code", () => {
    const executableLines = updateCodeBody
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    expect(executableLines).not.toMatch(/&\s*node\b/);
    expect(executableLines).not.toMatch(/&\s*aerender/i);
    expect(executableLines).not.toMatch(/callTool/);
    expect(executableLines).not.toMatch(/HeroicSwanMcpClient/);
    expect(executableLines).not.toMatch(/HeroicSwanTemplateInspector/);
    expect(executableLines).not.toMatch(/runCheckHealthDiagnostics/);
    expect(executableLines).not.toMatch(/executeRenderProject/);
    expect(executableLines).not.toMatch(/executeSceneEdit/);
    expect(executableLines).not.toMatch(/operation["']?\s*[:=]\s*["'](CHECK_HEALTH|RENDER|EXECUTE_FRAME)/);
    expect(executableLines).not.toMatch(/dispatchJob|POST.*\/api\/jobs/);
  });

  it("never opens, reads, or references any After Effects project path", () => {
    expect(updateCodeBody).not.toMatch(/\.aep\b/i);
  });
});

describe("DYO-Worker-Final-Update.ps1 verifies every new capability file, both before AND after the copy", () => {
  it("lists exactly the files scripts/package-windows-worker.mjs actually produced for this build", () => {
    const idx = updateScript.indexOf("$NewCapabilityFiles = @(");
    expect(idx).toBeGreaterThan(-1);
    const closeIdx = updateScript.indexOf(")", idx);
    const block = updateScript.slice(idx, closeIdx);
    for (const relativeFile of REAL_PACKAGED_FILES) {
      const windowsStyle = relativeFile.replace(/\//g, "\\");
      expect(block).toContain(windowsStyle);
    }
  });

  it("checks $NewCapabilityFiles (and the new supervisor files) exist in the source package BEFORE stopping/copying anything", () => {
    const sourceCheckIdx = updateScript.indexOf("foreach ($relativeFile in ($NewCapabilityFiles + $NewSupervisorFiles))");
    const stopIdx = updateScript.indexOf("Stopping DYO Worker safely");
    expect(sourceCheckIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(sourceCheckIdx);
  });

  it("re-checks $NewCapabilityFiles (and the new supervisor files) exist on disk AFTER the copy too, not just in the source package", () => {
    const copyIdx = updateScript.indexOf("Copy-Item -Path (Join-Path $sourceApp");
    const secondCheckIdx = updateScript.indexOf("foreach ($relativeFile in ($NewCapabilityFiles + $NewSupervisorFiles))", copyIdx);
    expect(copyIdx).toBeGreaterThan(-1);
    expect(secondCheckIdx).toBeGreaterThan(copyIdx);
    const block = updateScript.slice(secondCheckIdx, secondCheckIdx + 400);
    expect(block).toMatch(/Join-Path \$InstallDir \$relativeFile/);
    expect(block).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-Final-Update.ps1 fixes the IgnoreNew restart race with real PID-based verification", () => {
  it("records the OLD process PIDs before stopping, so 'new process' can mean something real later", () => {
    const idx = updateScript.indexOf("$oldPids = @(");
    expect(idx).toBeGreaterThan(-1);
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
    const startIdx = updateScript.indexOf("Start-ScheduledTask -TaskName $TaskName", idx);
    expect(startIdx).toBeGreaterThan(idx);
  });

  it("verifies the new process logged its own startup line before checking anything heartbeat-related", () => {
    const startupIdx = updateScript.indexOf("$startupLogged = Wait-Until");
    const heartbeatIdx = updateScript.indexOf("$heartbeatSucceeded = Wait-Until");
    expect(startupIdx).toBeGreaterThan(-1);
    expect(heartbeatIdx).toBeGreaterThan(startupIdx);
    const startupBlock = updateScript.slice(startupIdx, heartbeatIdx);
    expect(startupBlock).toMatch(/worker starting/);
    expect(startupBlock).toMatch(/if \(-not \$startupLogged\)/);
    expect(startupBlock).toMatch(/exit 1/);
  });

  it("accepts either a real successful heartbeat OR a genuinely logged retry attempt as success - never fails the install over a temporary delay", () => {
    const idx = updateScript.indexOf("$heartbeatSucceeded = Wait-Until");
    expect(idx).toBeGreaterThan(-1);
    expect(updateScript).toMatch(/heartbeat succeeded/);
    const block = updateScript.slice(idx, idx + 1200);
    expect(block).toMatch(/if \(\$heartbeatSucceeded\)/);
    expect(block).toMatch(/\$retrying = \$newContent -match '"msg":"heartbeat failed, will retry"' -or \$newContent -match "NEEDS_ATTENTION: DYO API rejected"/);
    expect(block).toMatch(/if \(\$retrying\)/);
  });

  it("only fails the install on genuine silence - no heartbeat success AND no logged retry attempt at all", () => {
    const idx = updateScript.indexOf("$retrying = $newContent");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 1000);
    expect(block).toMatch(/\} else \{/);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/neither a successful/i);
  });

  it("verifies all six capabilities (CHECK_HEALTH, INSPECT_TEMPLATE, INSPECT_SCENE_EVIDENCE, INSPECT_RENDER_CAPABILITIES, EXECUTE_FRAME, RENDER) all appear in the new process's own startup log line, and STOPs if not", () => {
    const declIdx = updateScript.indexOf("$expectedCapabilities = @(");
    expect(declIdx).toBeGreaterThan(-1);
    const declBlock = updateScript.slice(declIdx, declIdx + 200);
    expect(declBlock).toMatch(/CHECK_HEALTH/);
    expect(declBlock).toMatch(/INSPECT_TEMPLATE/);
    expect(declBlock).toMatch(/INSPECT_SCENE_EVIDENCE/);
    expect(declBlock).toMatch(/INSPECT_RENDER_CAPABILITIES/);
    expect(declBlock).toMatch(/EXECUTE_FRAME/);
    expect(declBlock).toMatch(/RENDER/);

    const idx = updateScript.indexOf('$newContent -match \'"msg":"worker starting"\'');
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 700);
    expect(block).toMatch(/missingCapabilities\.Count -eq 0/);
    expect(block).toMatch(/exit 1/);
  });

  it("requires the running build's commit to match the exact expected final commit, not just any commit marker", () => {
    const expectedIdx = updateScript.indexOf('$ExpectedCommit = "');
    expect(expectedIdx).toBeGreaterThan(-1);
    const expectedMatch = /\$ExpectedCommit = "([0-9a-f]{40})"/.exec(updateScript);
    expect(expectedMatch?.[1]).toMatch(/^[0-9a-f]{40}$/);

    const compareIdx = updateScript.indexOf("if ($runningCommit -ne $ExpectedCommit)");
    expect(compareIdx).toBeGreaterThan(-1);
    const block = updateScript.slice(compareIdx, compareIdx + 400);
    expect(block).toMatch(/exit 1/);
  });

  it('never prints "Update complete" before every verification step above has already passed', () => {
    const completeIdx = updateScript.indexOf("Update complete");
    const heartbeatCheckIdx = updateScript.indexOf("$heartbeatSucceeded = Wait-Until");
    const capabilityCheckIdx = updateScript.indexOf('$newContent -match \'"msg":"worker starting"\'');
    const buildInfoCheckIdx = updateScript.indexOf("$commitMatch = [regex]::Match");
    const exactCommitCheckIdx = updateScript.indexOf("if ($runningCommit -ne $ExpectedCommit)");
    expect(completeIdx).toBeGreaterThan(heartbeatCheckIdx);
    expect(completeIdx).toBeGreaterThan(capabilityCheckIdx);
    expect(completeIdx).toBeGreaterThan(buildInfoCheckIdx);
    expect(completeIdx).toBeGreaterThan(exactCommitCheckIdx);
  });
});

describe("DYO-Worker-Final-Update.ps1 refreshes the Scheduled Task's recovery settings, same identity", () => {
  it("uses the exact TaskName \"DYO Video Worker\"", () => {
    expect(updateScript).toMatch(/\$TaskName = "DYO Video Worker"/);
  });

  it("stops the task, refreshes its registration via the recovery helper, then starts it again", () => {
    expect(updateScript).toMatch(/Stop-ScheduledTask -TaskName \$TaskName/);
    expect(updateScript).toMatch(/\$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery/);
    expect(updateScript).toMatch(/Register-ScheduledTask -TaskName \$TaskName/);
    expect(updateScript).toMatch(/Start-ScheduledTask -TaskName \$TaskName/);
  });

  it("re-registers with the SAME identity - same hidden supervisor launcher path, same Windows user, same AtLogon trigger", () => {
    const idx = updateScript.indexOf("function Register-DyoWorkerTaskDefinition");
    expect(idx, "task definition helper not found").toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 1200);
    expect(block).toMatch(/New-ScheduledTaskAction -Execute "powershell\.exe"/);
    expect(block).toMatch(/-WindowStyle Hidden -File `"\$SupervisorLauncher`""/);
    expect(block).toMatch(/-WorkingDirectory \$InstallDir/);
    expect(block).toMatch(/New-ScheduledTaskTrigger -AtLogOn -User "\$env:USERDOMAIN\\\$env:USERNAME"/);
    expect(block).toMatch(/New-ScheduledTaskPrincipal -UserId "\$env:USERDOMAIN\\\$env:USERNAME" -LogonType Interactive -RunLevel Limited/);
  });

  it("never runs run-worker.bat directly as the task's own Action - only via the hidden powershell.exe + supervisor launcher chain", () => {
    const idx = updateScript.indexOf("function Register-DyoWorkerTaskDefinition");
    const block = updateScript.slice(idx, idx + 1200);
    expect(block).not.toMatch(/-Execute \$RunWorkerBat/);
    expect(block).not.toMatch(/-Execute \$runWorkerBat/);
  });

  it("applies the same robust auto-recovery settings a fresh Setup/Repair install gets", () => {
    const idx = updateScript.indexOf("$taskSettings = New-ScheduledTaskSettingsSet");
    expect(idx, "task settings block not found").toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/-RestartCount 999 -RestartInterval \(New-TimeSpan -Minutes 1\)/);
    expect(block).toMatch(/-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
    expect(block).toMatch(/-MultipleInstances IgnoreNew/);
    expect(block).toMatch(/-StartWhenAvailable/);
  });

  it("refreshes the task's registration AFTER the old process is confirmed stopped, and BEFORE the new one is started", () => {
    const stoppedIdx = updateScript.indexOf('Write-CheckResult $true "DYO Worker fully stopped');
    const refreshIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    const startIdx = updateScript.indexOf("Start-ScheduledTask -TaskName $TaskName", refreshIdx);
    expect(stoppedIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(stoppedIdx);
    expect(startIdx).toBeGreaterThan(refreshIdx);
  });

  it("never references WORKER_ID/WORKER_TOKEN/a registration secret in the task-refresh block - identity is untouched", () => {
    const idx = updateScript.indexOf("Refreshing automatic-recovery settings");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, updateScript.indexOf("Step 4", idx));
    expect(block).not.toMatch(/WORKER_ID|WORKER_TOKEN|WORKER_REGISTRATION_SECRET|worker-credentials/);
  });
});

describe("DYO-Worker-Final-Update.ps1 recovers from a legacy Scheduled Task with a null/empty Action.Execute (real client-machine bug)", () => {
  it("verifies the resulting task's own Action.Execute is real (non-null, non-empty) rather than trusting Register-ScheduledTask alone", () => {
    const idx = updateScript.indexOf("function Test-DyoWorkerTaskActionHealthy");
    expect(idx, "action-health verifier not found").toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/\$actions\[0\]\.Execute/);
    expect(block).toMatch(/IsNullOrWhiteSpace/);
  });

  it("tries -Force registration FIRST, so a legacy/corrupted task is overwritten atomically without ever calling Unregister-ScheduledTask against it directly", () => {
    const idx = updateScript.indexOf("function Set-DyoWorkerScheduledTaskRecovery");
    expect(idx, "recovery function not found").toBeGreaterThan(-1);
    const forceIdx = updateScript.indexOf("-Force", idx);
    const unregisterIdx = updateScript.indexOf("Unregister-ScheduledTask", idx);
    expect(forceIdx).toBeGreaterThan(idx);
    expect(unregisterIdx).toBeGreaterThan(forceIdx);
  });

  it("falls back to an explicit Unregister + fresh Register as a second recovery attempt if -Force alone did not produce a healthy action", () => {
    const idx = updateScript.indexOf("function Set-DyoWorkerScheduledTaskRecovery");
    const block = updateScript.slice(idx, idx + 2000);
    expect(block).toMatch(/Unregister-ScheduledTask -TaskName \$TaskName -Confirm:\$false -ErrorAction SilentlyContinue/);
    // Two independent Register-DyoWorkerTaskDefinition calls - one for
    // each recovery attempt - never just one.
    const registerCalls = block.match(/Register-DyoWorkerTaskDefinition/g) ?? [];
    expect(registerCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("never throws out of the recovery function itself - every Task Scheduler call is wrapped in try/catch", () => {
    const idx = updateScript.indexOf("function Set-DyoWorkerScheduledTaskRecovery");
    const endIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    const block = updateScript.slice(idx, endIdx);
    const tryCount = (block.match(/\btry\s*\{/g) ?? []).length;
    expect(tryCount).toBeGreaterThanOrEqual(2);
    expect(block).toMatch(/return \$false/);
  });
});

describe("DYO-Worker-Final-Update.ps1 never leaves DYO Worker stopped just because the task-recovery refresh failed", () => {
  it("does not exit when Set-DyoWorkerScheduledTaskRecovery returns $false - it logs a warning and continues to Step 5", () => {
    const callIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    expect(callIdx).toBeGreaterThan(-1);
    const ifIdx = updateScript.indexOf("if ($taskRefreshOk)", callIdx);
    expect(ifIdx).toBeGreaterThan(callIdx);
    const elseIdx = updateScript.indexOf("} else {", ifIdx);
    expect(elseIdx).toBeGreaterThan(ifIdx);
    const elseBlock = updateScript.slice(elseIdx, elseIdx + 500);
    expect(elseBlock).not.toMatch(/exit 1/);
    expect(elseBlock).toMatch(/Continuing anyway/i);

    // The very next real step after this if/else must still be Step 5's
    // restart - never an early return/exit sitting between them.
    const step5Idx = updateScript.indexOf("Step 5: restart DYO Worker", elseIdx);
    const anyExitBetween = updateScript.slice(elseIdx, step5Idx).match(/^\s*exit 1\s*$/m);
    expect(step5Idx).toBeGreaterThan(elseIdx);
    expect(anyExitBetween).toBeNull();
  });

  it("hardens both Start-ScheduledTask calls with -ErrorAction SilentlyContinue, so a task that ended up missing/broken cannot crash the script with an unhandled error", () => {
    const startCalls = [...updateScript.matchAll(/Start-ScheduledTask -TaskName \$TaskName[^\n]*/g)].map((m) => m[0]);
    expect(startCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of startCalls) {
      expect(call).toMatch(/-ErrorAction SilentlyContinue/);
    }
  });
});

describe("DYO-Worker-Final-Update.ps1 auto-repairs a completely missing Scheduled Task (real client blocker, 2026-08-30)", () => {
  it("existing healthy task: does not set $taskWasMissing and uses the normal refresh wording", () => {
    const idx = updateScript.indexOf("$taskWasMissing = -not $task");
    expect(idx).toBeGreaterThan(-1);
    const sourceAppIdx = updateScript.indexOf('$sourceApp = Join-Path $PSScriptRoot "worker-app"', idx);
    expect(sourceAppIdx).toBeGreaterThan(idx);
    const block = updateScript.slice(idx, sourceAppIdx);
    expect(block).toMatch(/if \(\$taskWasMissing\) \{/);
    expect(block).toMatch(/Existing automatic-startup task found - its recovery settings will be refreshed below, same identity/);
  });

  it("task completely missing: no longer exits - proceeds into the rest of the script instead of stopping the whole update", () => {
    const idx = updateScript.indexOf("$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue");
    expect(idx).toBeGreaterThan(-1);
    const sourceAppIdx = updateScript.indexOf('$sourceApp = Join-Path $PSScriptRoot "worker-app"', idx);
    expect(sourceAppIdx).toBeGreaterThan(idx);
    // Scoped to just the task-discovery block itself (up to the next,
    // unrelated package-completeness checks) - the old behavior
    // ("if (-not $task) { ... exit 1 }") must be gone from here.
    const block = updateScript.slice(idx, sourceAppIdx);
    expect(block).not.toMatch(/exit 1/);
    expect(block).toMatch(/it will be recreated automatically below/);
    expect(block).toMatch(/no repair package needed/);
  });

  it("does not require the client to run DYO-Worker-Repair.bat for a missing task anymore", () => {
    const idx = updateScript.indexOf("$taskWasMissing = -not $task");
    const sourceAppIdx = updateScript.indexOf('$sourceApp = Join-Path $PSScriptRoot "worker-app"', idx);
    const block = updateScript.slice(idx, sourceAppIdx);
    expect(block).not.toMatch(/DYO-Worker-Repair\.bat/);
  });

  it("credentials preserved: the worker-credentials.json presence check still runs before the task is even inspected - identity is decided first, independent of task state", () => {
    const credIdx = updateScript.indexOf("$credentialsPath = Join-Path $WorkRoot");
    const taskIdx = updateScript.indexOf("$task = Get-ScheduledTask -TaskName $TaskName");
    expect(credIdx).toBeGreaterThan(-1);
    expect(taskIdx).toBeGreaterThan(credIdx);
  });

  it("config preserved: the .env presence check also runs before the task is inspected, and .env is never written to as part of task recovery", () => {
    const envIdx = updateScript.indexOf('$envPath = Join-Path $InstallDir ".env"');
    const taskIdx = updateScript.indexOf("$task = Get-ScheduledTask -TaskName $TaskName");
    expect(envIdx).toBeGreaterThan(-1);
    expect(taskIdx).toBeGreaterThan(envIdx);
    const recoveryIdx = updateScript.indexOf("function Set-DyoWorkerScheduledTaskRecovery");
    const recoveryEndIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    const recoveryBlock = updateScript.slice(recoveryIdx, recoveryEndIdx);
    expect(recoveryBlock).not.toMatch(/Set-Content|\.env/);
  });

  it("no registration call: recreating the missing task never calls registerWorker or references a registration secret", () => {
    const idx = updateScript.indexOf("$taskWasMissing = -not $task");
    const step2Idx = updateScript.indexOf("Step 2: stop DYO Worker safely", idx);
    const block = updateScript.slice(idx, step2Idx);
    expect(block).not.toMatch(/registerWorker/i);
    expect(block).not.toMatch(/WORKER_REGISTRATION_SECRET/);
    expect(block).not.toMatch(/Read-Host/);
  });

  it("reuses the SAME Set-DyoWorkerScheduledTaskRecovery/Register-DyoWorkerTaskDefinition implementation for the missing-task case - no divergent duplicate logic", () => {
    const recoveryFnMatches = updateScript.match(/function Set-DyoWorkerScheduledTaskRecovery/g) ?? [];
    const registerFnMatches = updateScript.match(/function Register-DyoWorkerTaskDefinition/g) ?? [];
    const callSiteMatches = updateScript.match(/\$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery/g) ?? [];
    expect(recoveryFnMatches.length).toBe(1);
    expect(registerFnMatches.length).toBe(1);
    // Exactly one call site handles BOTH the missing-task and the
    // corrupted-task case - $taskWasMissing only changes messaging, never
    // which function recreates the task.
    expect(callSiteMatches.length).toBe(1);
  });

  it("recreated task has the correct recovery settings (RestartCount 999/1-minute interval, StartWhenAvailable, IgnoreNew, unlimited ExecutionTimeLimit, current-user AtLogon trigger)", () => {
    const idx = updateScript.indexOf("function Register-DyoWorkerTaskDefinition");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 1200);
    expect(block).toMatch(/New-ScheduledTaskTrigger -AtLogOn -User "\$env:USERDOMAIN\\\$env:USERNAME"/);
    expect(block).toMatch(/-RestartCount 999 -RestartInterval \(New-TimeSpan -Minutes 1\)/);
    expect(block).toMatch(/-StartWhenAvailable/);
    expect(block).toMatch(/-MultipleInstances IgnoreNew/);
    expect(block).toMatch(/-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
  });

  it("fixes the real undefined-variable bug (now against the supervisor launcher): $supervisorLauncher is resolved from the just-updated install and verified to exist BEFORE Set-DyoWorkerScheduledTaskRecovery is ever called", () => {
    const defIdx = updateScript.indexOf('$supervisorLauncher = Join-Path $InstallDir "run-worker-supervisor.ps1"');
    const callIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    expect(defIdx, "$supervisorLauncher definition not found - Set-DyoWorkerScheduledTaskRecovery would be called with an undefined path").toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(defIdx);
    const block = updateScript.slice(defIdx, defIdx + 400);
    expect(block).toMatch(/if \(-not \(Test-Path \$supervisorLauncher\)\)/);
    expect(block).toMatch(/exit 1/);
  });

  it("task gets started after update: Step 5's restart/PID verification is unconditional - it never checks $taskWasMissing, so a recreated task is started and verified exactly like a pre-existing one", () => {
    const step5Idx = updateScript.indexOf("Step 5: restart DYO Worker");
    expect(step5Idx).toBeGreaterThan(-1);
    const step5Block = updateScript.slice(step5Idx);
    expect(step5Block).not.toMatch(/taskWasMissing/);
    expect(step5Block).toMatch(/Start-ScheduledTask -TaskName \$TaskName/);
  });

  it("failure path does not silently report success: if the missing task cannot be recreated after two attempts, it prints NEEDS ATTENTION with an actionable next step, and this happens BEFORE the unconditional restart attempt", () => {
    const idx = updateScript.indexOf("} elseif ($taskWasMissing) {");
    expect(idx, "missing-task failure branch not found").toBeGreaterThan(-1);
    const step5Idx = updateScript.indexOf("Step 5: restart DYO Worker", idx);
    const block = updateScript.slice(idx, step5Idx);
    expect(block).toMatch(/NEEDS ATTENTION/);
    expect(block).toMatch(/could not be recreated/);
    expect(block).toMatch(/DYO-Worker-Repair\.bat/);
    expect(block).not.toMatch(/exit 1/);
    expect(block).not.toMatch(/\[OK\]/);
  });

  it("never leaves the Worker stopped just because a missing task could not be recreated - still falls through to the unconditional Step 5 restart attempt", () => {
    const failIdx = updateScript.indexOf("} elseif ($taskWasMissing) {");
    const step5Idx = updateScript.indexOf("Step 5: restart DYO Worker", failIdx);
    expect(failIdx).toBeGreaterThan(-1);
    expect(step5Idx).toBeGreaterThan(failIdx);
  });
});

describe("DYO-Worker-Final-Update.ps1 protects against duplicate worker instances end to end", () => {
  it("the refreshed task's own Settings block sets MultipleInstances IgnoreNew - Task Scheduler itself refuses to start a second run while one is active", () => {
    const idx = updateScript.indexOf("function Register-DyoWorkerTaskDefinition");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 1200);
    expect(block).toMatch(/-MultipleInstances IgnoreNew/);
  });

  it("recovering a legacy/corrupted task (both attempts) still preserves MultipleInstances IgnoreNew - a corrupted Action does not mean a corrupted duplicate-protection policy too", () => {
    const idx = updateScript.indexOf("function Set-DyoWorkerScheduledTaskRecovery");
    const endIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    const block = updateScript.slice(idx, endIdx);
    // Both recovery attempts go through Register-DyoWorkerTaskDefinition,
    // which is the one place MultipleInstances IgnoreNew is set - so
    // proving both attempts call it (already covered above) is what
    // guarantees this, restated here as its own explicit regression case.
    const registerCalls = block.match(/Register-DyoWorkerTaskDefinition/g) ?? [];
    expect(registerCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("verifies a genuinely NEW process (PID never seen before) before ever declaring the restart successful - never mistakes an old/leftover process for a fresh single instance", () => {
    expect(updateScript).toMatch(/\$oldPids -notcontains \$_/);
  });
});

describe("DYO-Worker-Final-Update.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-Final-Update.ps1 without asking for any input itself", () => {
    expect(updateBat).toMatch(/DYO-Worker-Final-Update\.ps1/);
    expect(updateBat).not.toMatch(/set \/p/i);
  });
});

describe("DYO-Worker-Final-Update.ps1 sets/clears the maintenance flag so the supervisor never fights this update (real fix for the 0xC000013A self-healing gap)", () => {
  it("defines $MaintenanceFlagPath under WorkRoot\\state, the exact path apps/worker/src/supervisor/maintenance-flag.ts checks", () => {
    expect(updateScript).toMatch(/\$MaintenanceFlagPath = Join-Path \$WorkRoot "state\\maintenance\.flag"/);
  });

  it("sets the flag BEFORE the actual Stop-ScheduledTask call in Step 2 - never after", () => {
    const setIdx = updateScript.indexOf("Set-Content -Path $MaintenanceFlagPath");
    const stopCallIdx = updateScript.indexOf('Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue\n}');
    expect(setIdx).toBeGreaterThan(-1);
    expect(stopCallIdx).toBeGreaterThan(setIdx);
  });

  it("clears the flag BEFORE Start-ScheduledTask in Step 5 - never after, so the freshly-started supervisor does not see a stale maintenance state", () => {
    const clearIdx = updateScript.indexOf("Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue");
    const startIdx = updateScript.indexOf("Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue");
    expect(clearIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(clearIdx);
  });

  it("the set and clear are on opposite sides of the entire stop/copy/refresh sequence - maintenance is active for the whole risky window, not just part of it", () => {
    const setIdx = updateScript.indexOf("Set-Content -Path $MaintenanceFlagPath");
    const copyIdx = updateScript.indexOf("Copy-Item -Path (Join-Path $sourceApp");
    const refreshIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    const clearIdx = updateScript.indexOf("Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue");
    expect(setIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeGreaterThan(setIdx);
    expect(refreshIdx).toBeGreaterThan(copyIdx);
    expect(clearIdx).toBeGreaterThan(refreshIdx);
  });
});

describe("DYO-Worker-Final-Update.ps1 replaces the visible run-worker.bat action with the hidden supervisor launcher (real fix for NTSTATUS 0xC000013A)", () => {
  it("resolves $supervisorLauncher from the just-updated install and verifies it exists before ever calling Set-DyoWorkerScheduledTaskRecovery", () => {
    const defIdx = updateScript.indexOf('$supervisorLauncher = Join-Path $InstallDir "run-worker-supervisor.ps1"');
    const callIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    expect(defIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(defIdx);
  });

  it("lists run-worker-supervisor.ps1 and dist/supervisor/index.js in $NewSupervisorFiles, verified both in the source package and after the copy", () => {
    const idx = updateScript.indexOf("$NewSupervisorFiles = @(");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, updateScript.indexOf(")", idx));
    expect(block).toContain("run-worker-supervisor.ps1");
    expect(block).toContain("dist\\supervisor\\index.js");
  });

  it("Register-DyoWorkerTaskDefinition never falls back to running run-worker.bat directly as the task's own Action", () => {
    expect(updateScript).not.toMatch(/-Execute \$supervisorLauncher\b/);
    expect(updateScript).not.toMatch(/-Execute \$runWorkerBat\b/);
  });
});
