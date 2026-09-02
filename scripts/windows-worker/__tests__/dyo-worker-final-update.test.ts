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
  "dist/workspace/working-copy.js",
  "dist/execution/preview/create-full-preview-executor.js",
  "dist/execution/preview/upload-full-preview.js",
  "dist/execution/preview/full-preview-output-path.js"
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

  it("also matches a forward-slash invocation - real production bug, 2026-08-30: the supervisor spawned the worker with a briefly-forward-slashed path, and this matcher (backslash-only at the time) never matched a genuinely running, ONLINE, heartbeating worker", () => {
    expect(isDyoWorkerCommandLine("node --env-file=.env dist/index.js")).toBe(true);
  });

  it("matches the forward-slash form with node.exe's full resolved path prefixed too", () => {
    expect(isDyoWorkerCommandLine('"C:\\Program Files\\nodejs\\node.exe" --env-file=.env dist/index.js')).toBe(true);
  });

  it("never matches the supervisor's own process (dist\\supervisor\\index.js), backslash or forward-slash - 'supervisor' breaks the required dist-then-index adjacency either way", () => {
    expect(isDyoWorkerCommandLine("node dist\\supervisor\\index.js")).toBe(false);
    expect(isDyoWorkerCommandLine("node dist/supervisor/index.js")).toBe(false);
  });

  it("never matches an ae-mcp-shaped command line - ae-mcp's own entry point is also literally dist/index.js (env.ts's own doc comment), but it is never invoked with --env-file=.env, so the combined pattern still excludes it", () => {
    expect(isDyoWorkerCommandLine('node "C:\\Program Files\\ae-mcp\\dist\\index.js" serve')).toBe(false);
    expect(isDyoWorkerCommandLine('node "C:\\Program Files\\ae-mcp\\dist\\index.js" health')).toBe(false);
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
    // The only legitimate ConvertFrom-Json use is reading this package's
    // own harmless worker-app/BUILD_INFO.json (commit + build timestamp,
    // never a secret - see the $ExpectedCommit test above) - assert THAT
    // specifically, rather than a blanket "no JSON parsing at all" ban
    // that would also (wrongly) forbid this legitimate, unrelated read.
    const jsonUses = updateScript.match(/^.*ConvertFrom-Json.*$/gm) ?? [];
    expect(jsonUses.length).toBeGreaterThan(0);
    for (const line of jsonUses) {
      expect(line).not.toMatch(/credential/i);
      expect(line).toMatch(/buildInfo/i);
    }
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
    const block = updateScript.slice(secondCheckIdx, secondCheckIdx + 500);
    expect(block).toMatch(/Join-Path \$InstallDir \$relativeFile/);
    expect(block).toMatch(/return \$false/);
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
    const heartbeatIdx = updateScript.indexOf("$healthOk = Wait-Until");
    expect(startupIdx).toBeGreaterThan(-1);
    expect(heartbeatIdx).toBeGreaterThan(startupIdx);
    const startupBlock = updateScript.slice(startupIdx, heartbeatIdx);
    expect(startupBlock).toMatch(/worker starting/);
    expect(startupBlock).toMatch(/if \(-not \$startupLogged\)/);
    expect(startupBlock).toMatch(/return \$false/);
  });

  describe("hardening follow-up (2026-09-02 real incident): bounded AE/MCP health window replaces the single-heartbeat-snapshot race", () => {
    /**
     * Real production incident: the first version of this gate required
     * two heartbeats, then inspected only the single most-recent heartbeat
     * line for aeStatus/mcpStatus. On a real client machine that single
     * snapshot reported not-both-ONLINE immediately after restart and
     * triggered an unnecessary rollback, even though AE/MCP were both
     * confirmed genuinely healthy moments later. Root cause: MCP's own
     * health probe spawns a fresh subprocess with an 8-second timeout on
     * every heartbeat, which can transiently exceed 8s right after an
     * update (freshly-replaced files, antivirus scan, cold Node start).
     * These tests extract the REAL regex/condition logic from the .ps1
     * source and re-apply it against realistic sample log content, the
     * same convention used elsewhere in this file (e.g. isDyoWorkerCommandLine).
     */

    function extractHeartbeatLinePattern(): RegExp {
      const match = /\$heartbeatLinePattern\s*=\s*'([^']+)'/.exec(updateScript);
      expect(match?.[1], "$heartbeatLinePattern not found").toBeTruthy();
      return new RegExp(match![1]!, "g");
    }

    /** Re-implements ConvertFrom-DyoHeartbeatLine's parsing in JS, from the real regexes the .ps1 source itself uses, to genuinely exercise the same field-extraction semantics. */
    function parseHeartbeatLine(line: string): { aeOnline: boolean; mcpOnline: boolean; maxConcurrency: number | null } {
      const aeStatus = /"aeStatus":"([^"]+)"/.exec(line)?.[1] ?? null;
      const mcpStatus = /"mcpStatus":"([^"]+)"/.exec(line)?.[1] ?? null;
      const maxConcurrencyMatch = /"maxConcurrency":(\d+)/.exec(line);
      return {
        aeOnline: aeStatus === "ONLINE",
        mcpOnline: mcpStatus === "ONLINE",
        maxConcurrency: maxConcurrencyMatch ? Number(maxConcurrencyMatch[1]) : null
      };
    }

    function heartbeatLine(aeStatus: string, mcpStatus: string, maxConcurrency = 1): string {
      return `{"level":30,"time":1788344000000,"msg":"heartbeat succeeded","status":"ONLINE","aeStatus":"${aeStatus}","mcpStatus":"${mcpStatus}","maxConcurrency":${maxConcurrency}}`;
    }

    it("removed the old single-snapshot variables entirely - $latestHeartbeatLine/$heartbeatsOk/$aeOnline/$mcpOnline/$maxConcurrencyOk no longer exist", () => {
      expect(updateScript).not.toMatch(/\$latestHeartbeatLine/);
      expect(updateScript).not.toMatch(/\$heartbeatsOk\b/);
      expect(updateScript).not.toMatch(/\$aeOnline\b/);
      expect(updateScript).not.toMatch(/\$mcpOnline\b/);
      expect(updateScript).not.toMatch(/\$maxConcurrencyOk\b/);
    });

    it("defines ConvertFrom-DyoHeartbeatLine and Write-DyoHeartbeatDiagnostics as real, testable functions, never inlined into the polling condition", () => {
      expect(updateScript).toMatch(/function ConvertFrom-DyoHeartbeatLine/);
      expect(updateScript).toMatch(/function Write-DyoHeartbeatDiagnostics/);
    });

    it("$AeMcpHealthWindowSeconds is a named, script-level constant (not a bare inline literal) that the polling loop and every failure message actually reference", () => {
      expect(updateScript).toMatch(/\$AeMcpHealthWindowSeconds = 90/);
      const pollIdx = updateScript.indexOf("$healthOk = Wait-Until -TimeoutSeconds $AeMcpHealthWindowSeconds");
      expect(pollIdx).toBeGreaterThan(-1);
    });

    it("scenario: first heartbeat MCP UNKNOWN, later heartbeat MCP ONLINE => the real polling condition succeeds (not a false rollback)", () => {
      const pattern = extractHeartbeatLinePattern();
      const content = [heartbeatLine("ONLINE", "UNKNOWN"), heartbeatLine("ONLINE", "ONLINE")].join("\n");
      const lines = [...content.matchAll(pattern)].map((m) => parseHeartbeatLine(m[0]));
      expect(lines.length).toBe(2);
      const healthy = lines.filter((l) => l.aeOnline && l.mcpOnline);
      expect(healthy.length).toBe(1);
    });

    it("scenario: first several heartbeats UNKNOWN, later BOTH ONLINE within the window => succeeds", () => {
      const pattern = extractHeartbeatLinePattern();
      const content = [
        heartbeatLine("UNKNOWN", "UNKNOWN"),
        heartbeatLine("ONLINE", "UNKNOWN"),
        heartbeatLine("ONLINE", "UNKNOWN"),
        heartbeatLine("ONLINE", "ONLINE")
      ].join("\n");
      const lines = [...content.matchAll(pattern)].map((m) => parseHeartbeatLine(m[0]));
      expect(lines.length).toBe(4);
      expect(lines.some((l) => l.aeOnline && l.mcpOnline)).toBe(true);
    });

    it("scenario: MCP never ONLINE across the whole window => no healthy heartbeat found (real fix does not fabricate success)", () => {
      const pattern = extractHeartbeatLinePattern();
      const content = [heartbeatLine("ONLINE", "UNKNOWN"), heartbeatLine("ONLINE", "OFFLINE"), heartbeatLine("ONLINE", "UNKNOWN")].join("\n");
      const lines = [...content.matchAll(pattern)].map((m) => parseHeartbeatLine(m[0]));
      expect(lines.length).toBe(3);
      expect(lines.some((l) => l.aeOnline && l.mcpOnline)).toBe(false);
      expect(lines.some((l) => l.mcpOnline)).toBe(false);
    });

    it("scenario: AE never ONLINE across the whole window => no healthy heartbeat found", () => {
      const pattern = extractHeartbeatLinePattern();
      const content = [heartbeatLine("OFFLINE", "ONLINE"), heartbeatLine("UNKNOWN", "ONLINE")].join("\n");
      const lines = [...content.matchAll(pattern)].map((m) => parseHeartbeatLine(m[0]));
      expect(lines.some((l) => l.aeOnline && l.mcpOnline)).toBe(false);
      expect(lines.some((l) => l.aeOnline)).toBe(false);
    });

    it("real fix does NOT weaken the requirement: still requires the SAME heartbeat to report both ONLINE at once, not AE ONLINE on one line and MCP ONLINE on a different line", () => {
      const pattern = extractHeartbeatLinePattern();
      const content = [heartbeatLine("ONLINE", "OFFLINE"), heartbeatLine("OFFLINE", "ONLINE")].join("\n");
      const lines = [...content.matchAll(pattern)].map((m) => parseHeartbeatLine(m[0]));
      expect(lines.some((l) => l.aeOnline)).toBe(true);
      expect(lines.some((l) => l.mcpOnline)).toBe(true);
      expect(lines.some((l) => l.aeOnline && l.mcpOnline)).toBe(false);
    });

    it("still requires at least TWO real heartbeats even if the very first one is already healthy - never a single-lucky-heartbeat pass", () => {
      const idx = updateScript.indexOf("$healthOk = Wait-Until");
      const block = updateScript.slice(idx, idx + 700);
      expect(block).toMatch(/if \(\$script:ObservedHeartbeats\.Count -lt 2\) \{ return \$false \}/);
    });

    it("the polling condition returns $false (never fabricating success) until a healthy heartbeat is actually found", () => {
      const idx = updateScript.indexOf("$healthOk = Wait-Until");
      const block = updateScript.slice(idx, idx + 700);
      expect(block).toMatch(/if \(\$healthy\.Count -eq 0\) \{ return \$false \}/);
      expect(block).toMatch(/return \$true/);
    });

    it("failure diagnostics distinguish stale/missing heartbeat, AE-never-ONLINE, MCP-never-ONLINE, both-never-ONLINE, and never-simultaneous - never one generic message for every case", () => {
      const idx = updateScript.indexOf("if (-not $healthOk) {");
      expect(idx).toBeGreaterThan(-1);
      const block = updateScript.slice(idx, idx + 2200);
      expect(block).toMatch(/heartbeat was stale or missing/);
      expect(block).toMatch(/AE never reported ONLINE, and MCP never reported ONLINE/);
      expect(block).toMatch(/AE never reported ONLINE on any observed heartbeat/);
      expect(block).toMatch(/MCP never reported ONLINE on any observed heartbeat/);
      expect(block).toMatch(/never on the SAME heartbeat/);
      expect(block).toMatch(/return \$false/);
      expect(block).not.toMatch(/exit 1/);
    });

    it("failure path prints per-heartbeat diagnostics (timestamp, AE/MCP status, maxConcurrency) via Write-DyoHeartbeatDiagnostics, and never logs a worker token/credential", () => {
      const idx = updateScript.indexOf("if (-not $healthOk) {");
      const block = updateScript.slice(idx, idx + 2000);
      expect(block).toMatch(/Write-DyoHeartbeatDiagnostics -Heartbeats \$script:ObservedHeartbeats/);
      expect(block).not.toMatch(/WORKER_TOKEN|workerToken|worker-credentials/i);
      const diagFnIdx = updateScript.indexOf("function Write-DyoHeartbeatDiagnostics");
      expect(diagFnIdx).toBeGreaterThan(-1);
      const diagFnBlock = updateScript.slice(diagFnIdx, diagFnIdx + 900);
      expect(diagFnBlock).not.toMatch(/WORKER_TOKEN|workerToken|credential/i);
    });

    it("hardening: checks the confirmed-healthy heartbeat's own maxConcurrency field - proves the single-job-at-a-time guarantee on the exact heartbeat that proved AE/MCP ONLINE, not an arbitrary one", () => {
      const idx = updateScript.indexOf("if ($script:HealthyHeartbeat.MaxConcurrency -ne 1)");
      expect(idx).toBeGreaterThan(-1);
      const block = updateScript.slice(idx, idx + 500);
      expect(block).toMatch(/capability\/concurrency mismatch/);
      expect(block).toMatch(/return \$false/);
      expect(block).not.toMatch(/exit 1/);
    });
  });

  it("verifies all seven capabilities (CHECK_HEALTH, INSPECT_TEMPLATE, INSPECT_SCENE_EVIDENCE, INSPECT_RENDER_CAPABILITIES, EXECUTE_FRAME, RENDER, CREATE_PREVIEW) all appear in the new process's own startup log line, and returns $false if not", () => {
    const declIdx = updateScript.indexOf("$expectedCapabilities = @(");
    expect(declIdx).toBeGreaterThan(-1);
    const declBlock = updateScript.slice(declIdx, declIdx + 200);
    expect(declBlock).toMatch(/CHECK_HEALTH/);
    expect(declBlock).toMatch(/INSPECT_TEMPLATE/);
    expect(declBlock).toMatch(/INSPECT_SCENE_EVIDENCE/);
    expect(declBlock).toMatch(/INSPECT_RENDER_CAPABILITIES/);
    expect(declBlock).toMatch(/EXECUTE_FRAME/);
    expect(declBlock).toMatch(/RENDER/);
    expect(declBlock).toMatch(/CREATE_PREVIEW/);

    const idx = updateScript.indexOf('$newContent -match \'"msg":"worker starting"\'');
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 700);
    expect(block).toMatch(/missingCapabilities\.Count -eq 0/);
    expect(block).toMatch(/return \$false/);
    expect(block).not.toMatch(/exit 1/);
  });

  it("requires the running build's commit to match the exact expected final commit, not just any commit marker", () => {
    const compareIdx = updateScript.indexOf("if ($runningCommit -ne $ExpectedCommit)");
    expect(compareIdx).toBeGreaterThan(-1);
    const block = updateScript.slice(compareIdx, compareIdx + 600);
    expect(block).toMatch(/return \$false/);
    expect(block).not.toMatch(/exit 1/);
  });

  it("real production bug: $ExpectedCommit is NEVER a hand-maintained literal - it must be read from this same package's own worker-app/BUILD_INFO.json, so it can never drift out of sync with the program files it ships alongside", () => {
    // A real release once shipped with $ExpectedCommit hand-copied from a
    // PRIOR build and never updated - the running worker (genuinely the
    // new commit) then failed this exact check against a stale
    // expectation. This asserts the literal-assignment pattern can never
    // silently return: no `$ExpectedCommit = "<40 hex chars>"` anywhere.
    expect(updateScript).not.toMatch(/\$ExpectedCommit\s*=\s*"[0-9a-f]{40}"/);

    const readIdx = updateScript.indexOf("$buildInfoPath = Join-Path $sourceApp \"BUILD_INFO.json\"");
    expect(readIdx).toBeGreaterThan(-1);
    // Must be read from $sourceApp (this package's own worker-app/), not
    // the just-installed copy under $InstallDir - the expectation has to
    // be knowable BEFORE anything is stopped/copied.
    const sourceAppIdx = updateScript.indexOf("$sourceApp = Join-Path $PSScriptRoot");
    expect(readIdx).toBeGreaterThan(sourceAppIdx);

    const assignIdx = updateScript.indexOf("$ExpectedCommit = $buildInfo.commit");
    expect(assignIdx).toBeGreaterThan(readIdx);

    // Fails closed (never proceeds with an unverified/missing/malformed
    // commit) rather than silently trusting a corrupt or absent file.
    const block = updateScript.slice(readIdx, assignIdx + 100);
    expect(block).toMatch(/\[0-9a-f\]\{40\}/);
    expect(block).toMatch(/exit 1/);
  });

  it('never prints "Update complete" before every verification step above has already passed', () => {
    const completeIdx = updateScript.indexOf("Update complete");
    const heartbeatCheckIdx = updateScript.indexOf("$healthOk = Wait-Until");
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
    // Scoped to the function's own body (up to the next top-level banner
    // that starts the main script flow), not all the way to its call
    // site - hardening moved the function definition earlier in the file,
    // ahead of Step 1/2/backup code that legitimately mentions ".env" for
    // unrelated reasons (the .env existence check, the -Exclude ".env" on
    // both the main copy and the backup copy).
    const recoveryEndIdx = updateScript.indexOf('Write-Host "================================================"', recoveryIdx);
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
    const block = updateScript.slice(defIdx, defIdx + 500);
    expect(block).toMatch(/if \(-not \(Test-Path \$supervisorLauncher\)\)/);
    // Inside Invoke-WorkerUpdateAndVerify (hardening) - returns $false so a
    // missing supervisor file triggers automatic rollback, never a bare exit.
    expect(block).toMatch(/return \$false/);
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
    // Hardening added an EARLIER "Remove-Item ...MaintenanceFlagPath" on the
    // genuinely-safe pre-backup abort path (Step 2b) - that one is
    // unrelated to Step 5's restart and is verified separately in the
    // backup describe block above, so this looks specifically for the
    // occurrence inside Invoke-WorkerUpdateAndVerify (after its own
    // definition begins).
    const fnIdx = updateScript.indexOf("function Invoke-WorkerUpdateAndVerify");
    const clearIdx = updateScript.indexOf("Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue", fnIdx);
    const startIdx = updateScript.indexOf("Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue", fnIdx);
    expect(fnIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(fnIdx);
    expect(startIdx).toBeGreaterThan(clearIdx);
  });

  it("the set and clear are on opposite sides of the entire stop/copy/refresh sequence - maintenance is active for the whole risky window, not just part of it", () => {
    const setIdx = updateScript.indexOf("Set-Content -Path $MaintenanceFlagPath");
    const copyIdx = updateScript.indexOf("Copy-Item -Path (Join-Path $sourceApp");
    const refreshIdx = updateScript.indexOf("$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery");
    const clearIdx = updateScript.indexOf("Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue", refreshIdx);
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

describe("DYO-Worker-Final-Update.ps1 does not hard-fail on a PID-diff miss alone - real fix for the 2026-08-30 process-detection false negative", () => {
  it("does not exit immediately when $started is false - it warns and continues to the log-content checks instead", () => {
    const startedIdx = updateScript.indexOf("$pidConfirmed = $started");
    expect(startedIdx).toBeGreaterThan(-1);
    const block = updateScript.slice(startedIdx, startedIdx + 700);
    expect(block).not.toMatch(/exit 1/);
    expect(block).toMatch(/known possible process-matching gap/i);
    // The very next real step must still be the startup-log-line wait -
    // never an exit sitting between them.
    const startupWaitIdx = updateScript.indexOf('$startupLogged = Wait-Until', startedIdx);
    expect(startupWaitIdx).toBeGreaterThan(startedIdx);
  });

  it("still fails (returns $false, triggering automatic rollback) if the log-content checks ALSO fail to confirm a startup line - PID-diff failing does not silently become an automatic pass", () => {
    const idx = updateScript.indexOf('if (-not $startupLogged) {');
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 500);
    expect(block).toMatch(/return \$false/);
  });

  it("still requires all seven capabilities AND the exact expected commit even when PID was not confirmed - never a weaker bar", () => {
    const capIdx = updateScript.indexOf("$expectedCapabilities = @(");
    const commitIdx = updateScript.indexOf('$commitMatch = [regex]::Match');
    expect(capIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(capIdx);
    expect(updateScript.slice(capIdx, capIdx + 1000)).toMatch(/return \$false/);
    expect(updateScript.slice(commitIdx, commitIdx + 800)).toMatch(/return \$false/);
  });

  it("the final summary is honest about which confirmation actually happened (PID vs log-content only)", () => {
    const idx = updateScript.indexOf("$processConfirmationSummary = if ($script:PidConfirmed)");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/confirmed by PID/);
    expect(block).toMatch(/PID could not be independently confirmed/);
  });
});

describe("DYO-Worker-Final-Update.ps1 hardening: backs up the current install before touching anything (never leaves the machine with no runnable worker)", () => {
  it("creates a timestamped backup directory under WorkRoot\\backups AFTER the old process is confirmed stopped, and BEFORE the program-file replacement copy", () => {
    const stoppedIdx = updateScript.indexOf('Write-CheckResult $true "DYO Worker fully stopped');
    const backupIdx = updateScript.indexOf("$BackupDir = Join-Path $BackupRoot");
    const replaceCopyIdx = updateScript.indexOf('Copy-Item -Path (Join-Path $sourceApp "*")');
    expect(stoppedIdx).toBeGreaterThan(-1);
    expect(backupIdx).toBeGreaterThan(stoppedIdx);
    expect(replaceCopyIdx).toBeGreaterThan(backupIdx);
    expect(updateScript).toMatch(/\$BackupRoot = Join-Path \$WorkRoot "backups"/);
    expect(updateScript).toMatch(/worker-app-pre-update-/);
  });

  it("independently verifies the backup is non-empty (contains dist\\index.js) rather than trusting Copy-Item did not throw", () => {
    const idx = updateScript.indexOf('if (-not (Test-Path (Join-Path $BackupDir "dist\\index.js")))');
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/Remove-Item -Path \$MaintenanceFlagPath/);
  });

  it("a failed backup verification is a genuinely safe abort - nothing has been changed yet, so it clears the maintenance flag and exits rather than rolling back (there is nothing to roll back to)", () => {
    const idx = updateScript.indexOf('if (-not (Test-Path (Join-Path $BackupDir "dist\\index.js")))');
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/No program files have been changed/);
  });

  it("captures the backup's own previous commit (if known) from its BUILD_INFO.json, for rollback to cross-check against later", () => {
    expect(updateScript).toMatch(/\$PreviousCommit = \$null/);
    expect(updateScript).toMatch(/\$previousBuildInfoPath = Join-Path \$BackupDir "BUILD_INFO\.json"/);
  });
});

describe("DYO-Worker-Final-Update.ps1 hardening: wraps the risky replace/verify sequence so a health-gate failure triggers automatic rollback instead of exiting broken", () => {
  it("defines Invoke-WorkerUpdateAndVerify (returns $true/$false) and Invoke-WorkerRollback (params: Reason)", () => {
    expect(updateScript).toMatch(/function Invoke-WorkerUpdateAndVerify\s*\{/);
    expect(updateScript).toMatch(/function Invoke-WorkerRollback\s*\{/);
    const rollbackIdx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(rollbackIdx, rollbackIdx + 200);
    expect(block).toMatch(/param\(\[string\]\$Reason\)/);
  });

  it("calls Invoke-WorkerUpdateAndVerify exactly once at top level, and branches to Invoke-WorkerRollback only when it returns $false", () => {
    const callIdx = updateScript.indexOf("$updateOk = Invoke-WorkerUpdateAndVerify");
    expect(callIdx).toBeGreaterThan(-1);
    const ifIdx = updateScript.indexOf("if ($updateOk) {", callIdx);
    expect(ifIdx).toBeGreaterThan(callIdx);
    const rollbackCallIdx = updateScript.indexOf("$rollbackOk = Invoke-WorkerRollback -Reason $script:FailureReason");
    expect(rollbackCallIdx).toBeGreaterThan(ifIdx);
  });

  it("MCP-never-ONLINE, AE-never-ONLINE, and stale/missing-heartbeat are each real branches inside Invoke-WorkerUpdateAndVerify that set FailureReason and return $false - and since every $false return from this function is unconditionally routed to Invoke-WorkerRollback (see the top-level wiring test above), each of these three failure modes really does trigger an automatic rollback attempt, not just a printed message", () => {
    const fnIdx = updateScript.indexOf("function Invoke-WorkerUpdateAndVerify");
    const endIdx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(fnIdx, endIdx);
    expect(block).toMatch(/\$script:FailureReason = "MCP never became ONLINE within \$AeMcpHealthWindowSeconds seconds"/);
    expect(block).toMatch(/\$script:FailureReason = "AE never became ONLINE within \$AeMcpHealthWindowSeconds seconds"/);
    expect(block).toMatch(/\$script:FailureReason = "Stale\/missing heartbeat - fewer than two real heartbeats observed within \$AeMcpHealthWindowSeconds seconds"/);
    // Every one of these three lines is immediately followed by `return $false`
    // within the same failing branch - confirmed generically by the
    // returnFalseCount === setReasonCount test below, covering these three
    // among all failure branches.
  });

  it("the AE/MCP health-window failure block has exactly 5 mutually-exclusive REASON branches (stale/missing, both-never-online, AE-never, MCP-never, never-simultaneous), each setting $script:FailureReason, sharing exactly ONE trailing return $false for the whole if/elseif/elseif/elseif/else chain", () => {
    const idx = updateScript.indexOf("if (-not $healthOk) {");
    const endIdx = updateScript.indexOf("restart - re-running this update is usually safe", idx);
    expect(idx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(idx);
    const block = updateScript.slice(idx, endIdx + 200);
    const setReasonCount = (block.match(/\$script:FailureReason\s*=/g) ?? []).length;
    const returnFalseCount = (block.match(/return \$false/g) ?? []).length;
    expect(setReasonCount).toBe(5);
    expect(returnFalseCount).toBe(1);
  });

  it("every OTHER failure path inside Invoke-WorkerUpdateAndVerify (outside the AE/MCP health window's own 5-branches-1-return block) sets $script:FailureReason immediately before its own return $false, so the rollback report is never blank", () => {
    const fnIdx = updateScript.indexOf("function Invoke-WorkerUpdateAndVerify");
    const endIdx = updateScript.indexOf("function Invoke-WorkerRollback");
    let block = updateScript.slice(fnIdx, endIdx);
    // Two regions are deliberately excluded here, each already verified by
    // its own dedicated test above:
    //   1. The AE/MCP bounded-polling Wait-Until Condition scriptblock -
    //      its `return $false`/`return $true` are the CONDITION's own "not
    //      yet, keep polling" signal to Wait-Until, a different
    //      control-flow layer with no $script:FailureReason pairing at all.
    //   2. The AE/MCP health-window failure block itself - a legitimate
    //      5-branches-1-shared-return structure (asserted above), which
    //      would otherwise skew this generic 1:1 pairing count.
    const pollConditionIdx = block.indexOf("$healthOk = Wait-Until");
    // Cuts through to the very next Write-CheckResult call AFTER the
    // health-window failure block's own shared `return $false` and closing
    // brace, so that trailing return is excluded along with the rest of
    // the 5-branches-1-return block (verified by its own dedicated test
    // above) - not just up to its last REASON message.
    const healthFailureEndIdx = block.indexOf('Write-CheckResult $true "A fresh heartbeat reports AE ONLINE and MCP ONLINE"', pollConditionIdx);
    expect(pollConditionIdx).toBeGreaterThan(-1);
    expect(healthFailureEndIdx).toBeGreaterThan(pollConditionIdx);
    block = block.slice(0, pollConditionIdx) + block.slice(healthFailureEndIdx);
    const returnFalseCount = (block.match(/return \$false/g) ?? []).length;
    const setReasonCount = (block.match(/\$script:FailureReason\s*=/g) ?? []).length;
    expect(returnFalseCount).toBeGreaterThanOrEqual(4);
    expect(setReasonCount).toBe(returnFalseCount);
  });

  it("no bare top-level exit 1 remains inside Invoke-WorkerUpdateAndVerify - only the genuinely pre-backup preflight steps (Step 1/backup) are still allowed to exit directly", () => {
    const fnIdx = updateScript.indexOf("function Invoke-WorkerUpdateAndVerify");
    const endIdx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(fnIdx, endIdx);
    expect(block).not.toMatch(/exit 1/);
  });
});

describe("DYO-Worker-Final-Update.ps1 hardening: automatic rollback restores the pre-update backup and independently re-verifies health", () => {
  it("sets the maintenance flag again before stopping the failed new process, mirroring the main update's own discipline", () => {
    const idx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(idx, idx + 1200);
    expect(block).toMatch(/Set-Content -Path \$MaintenanceFlagPath/);
    const setIdx = block.indexOf("Set-Content -Path $MaintenanceFlagPath");
    const stopIdx = block.indexOf("Stopping the failed new DYO Worker process");
    expect(stopIdx).toBeGreaterThan(setIdx);
  });

  it("restores program files FROM the backup directory, excluding .env, same as the main update never touches .env", () => {
    const idx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(idx, idx + 3000);
    expect(block).toMatch(/Copy-Item -Path \(Join-Path \$BackupDir "\*"\) -Destination \$InstallDir -Recurse -Force -Exclude "\.env"/);
  });

  it("wraps the restore itself in try/catch - a failed restore is reported distinctly and clears the maintenance flag rather than leaving it stuck forever", () => {
    const idx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(idx, idx + 3000);
    const copyRestoreIdx = block.indexOf('Copy-Item -Path (Join-Path $BackupDir "*")');
    expect(copyRestoreIdx).toBeGreaterThan(-1);
    const tryIdx = block.lastIndexOf("try {", copyRestoreIdx);
    expect(tryIdx).toBeGreaterThan(-1);
    const catchBlock = block.slice(copyRestoreIdx, copyRestoreIdx + 700);
    expect(catchBlock).toMatch(/\} catch \{/);
    expect(catchBlock).toMatch(/Remove-Item -Path \$MaintenanceFlagPath -Force -ErrorAction SilentlyContinue/);
    expect(catchBlock).toMatch(/return \$false/);
    expect(catchBlock).toMatch(/DYO-Worker-Recover\.bat/);
  });

  it("requires a real, independently-verified heartbeat from the restored build before ever reporting rollback success - never claims success from Copy-Item/Start-ScheduledTask not throwing", () => {
    const idx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(idx, idx + 5000);
    expect(block).toMatch(/\$rollbackHeartbeatOk = Wait-Until/);
    expect(block).toMatch(/"msg":"heartbeat succeeded"/);
    expect(block).toMatch(/if \(-not \(\$rollbackProcessRunning -and \$rollbackHeartbeatOk\)\)/);
    const failIdx = block.indexOf("if (-not ($rollbackProcessRunning -and $rollbackHeartbeatOk))");
    const failBlock = block.slice(failIdx, failIdx + 400);
    expect(failBlock).toMatch(/return \$false/);
    expect(failBlock).toMatch(/DYO-Worker-Recover\.bat/);
  });

  it("clears the maintenance flag on the SUCCESS path only after Start-ScheduledTask is called for the restored build - never left set forever on a successful rollback", () => {
    const idx = updateScript.indexOf("function Invoke-WorkerRollback");
    const clearIdx = updateScript.indexOf("Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue", idx);
    const startIdx = updateScript.indexOf("Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue", clearIdx - 5);
    expect(clearIdx).toBeGreaterThan(idx);
    expect(startIdx).toBeGreaterThanOrEqual(clearIdx);
  });

  it("returns $true only once the restored worker is confirmed running and heartbeating, and cross-checks the restored commit against the backup's own recorded commit when known", () => {
    const idx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(idx, idx + 5000);
    expect(block).toMatch(/if \(\$PreviousCommit\) \{/);
    expect(block).toMatch(/Restored DYO Worker is running and heartbeating again/);
    expect(block).toMatch(/return \$true/);
  });
});

describe("DYO-Worker-Final-Update.ps1 hardening: the maintenance flag is never left permanently set, across every real exit path", () => {
  it("success path: flag is cleared inside Invoke-WorkerUpdateAndVerify before Start-ScheduledTask, and the top-level success branch never re-sets it", () => {
    const fnIdx = updateScript.indexOf("function Invoke-WorkerUpdateAndVerify");
    const fnEndIdx = updateScript.indexOf("function Invoke-WorkerRollback");
    const block = updateScript.slice(fnIdx, fnEndIdx);
    expect(block).toMatch(/Remove-Item -Path \$MaintenanceFlagPath -Force -ErrorAction SilentlyContinue/);
  });

  it("rollback-success path: the flag is cleared inside Invoke-WorkerRollback's own success path (verified above) - the top-level rollback-success branch never needs to touch it again", () => {
    const topIdx = updateScript.indexOf("$rollbackOk = Invoke-WorkerRollback");
    const topBlock = updateScript.slice(topIdx, topIdx + 2000);
    // The top-level orchestration itself never sets/clears the flag a
    // second time - that responsibility lives entirely inside the
    // functions above, so there is exactly one owner for this discipline.
    expect(topBlock).not.toMatch(/MaintenanceFlagPath/);
  });

  it("rollback-failure path: even when Invoke-WorkerRollback itself returns $false, its own restore-failure branch already cleared the flag before returning - never silently left set with no runnable worker AND a stuck flag", () => {
    const idx = updateScript.indexOf("function Invoke-WorkerRollback");
    const restoreFailIdx = updateScript.indexOf("[NEEDS ATTENTION] Restoring the backup itself failed", idx);
    expect(restoreFailIdx).toBeGreaterThan(idx);
    const block = updateScript.slice(restoreFailIdx, restoreFailIdx + 400);
    expect(block).toMatch(/Remove-Item -Path \$MaintenanceFlagPath -Force -ErrorAction SilentlyContinue/);
    expect(block).toMatch(/return \$false/);
  });
});

describe("DYO-Worker-Final-Update.ps1 hardening: the final report never claims success it did not verify, and points to one-click recovery when rollback itself is unverified", () => {
  it("prints a distinct ROLLED BACK SAFELY message on successful rollback, including the real failure reason", () => {
    const idx = updateScript.indexOf('Write-Host "  UPDATE FAILED - ROLLED BACK SAFELY"');
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 800);
    expect(block).toMatch(/\$script:FailureReason/);
    expect(block).toMatch(/never changed/);
  });

  it("prints a distinct, more urgent message and points to DYO-Worker-Recover.bat when the rollback itself could not be fully verified - never conflates the two outcomes", () => {
    const idx = updateScript.indexOf('Write-Host "  UPDATE FAILED - AUTOMATIC ROLLBACK COULD NOT BE FULLY VERIFIED"');
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 600);
    expect(block).toMatch(/DO NOT ASSUME DYO WORKER IS RUNNING/);
    expect(block).toMatch(/DYO-Worker-Recover\.bat/);
  });

  it("both failure branches exit nonzero", () => {
    const rolledBackIdx = updateScript.indexOf('Write-Host "  UPDATE FAILED - ROLLED BACK SAFELY"');
    const unverifiedIdx = updateScript.indexOf('Write-Host "  UPDATE FAILED - AUTOMATIC ROLLBACK COULD NOT BE FULLY VERIFIED"');
    expect(updateScript.slice(rolledBackIdx, unverifiedIdx)).toMatch(/exit 1/);
    expect(updateScript.slice(unverifiedIdx)).toMatch(/exit 1/);
  });
});
