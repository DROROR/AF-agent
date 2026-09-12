import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-CombinedFix2-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-CombinedFix2-Update.bat"), "utf8");

const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

/**
 * DYO-Worker-CombinedFix2-Update.ps1 batches two real 2026-09-11 fixes
 * (legacy-project-conversion detection - a worker-app code change picked
 * up automatically by the program-file copy step, no new script logic
 * needed for it - and the process-cleanup restart fix) into ONE update
 * package, per the standing instruction to batch Worker changes. These
 * tests assert the same safety properties every prior *-Update.ps1 in
 * this folder guarantees.
 */
describe("DYO-Worker-CombinedFix2-Update.ps1 only ever targets DYO Worker's own two known command lines", () => {
  it("matches processes by exact command-line substring, never by process name alone", () => {
    expect(updateScript).toMatch(/\[regex\]::Escape\("dist\\supervisor\\index\.js"\)/);
    expect(updateScript).toMatch(/\[regex\]::Escape\("--env-file=\.env dist\\index\.js"\)/);
  });

  it("REAL BUG REGRESSION (2026-09-12): never matches on the bare \"dist\\index.js\" substring, which also matches ae-mcp's own process and killed the AE bridge", () => {
    // ae-mcp is spawned by this worker as
    //   node <AE_MCP_PATH>\dist\index.js serve
    // (an ABSOLUTE path - see heroic-swan-mcp-client.ts's StdioClientTransport
    // args), whereas the worker's own child is always
    //   node --env-file=.env dist\index.js
    // (a RELATIVE path preceded by --env-file - see spawn-worker-child.ts's
    // buildWorkerChildArgs). Matching the bare tail matched BOTH, so the
    // cleanup step killed the ae-mcp bridge and its health probe then
    // reported exit code 1 (mcp_status OFFLINE) right after this update.
    const patternStart = updateScript.indexOf("$WorkerProcessCommandLinePatterns");
    expect(patternStart).toBeGreaterThan(-1);
    const patternBlock = updateScript.slice(patternStart, patternStart + 400);
    expect(patternBlock).not.toMatch(/Escape\("dist\\index\.js"\)/);
    // The worker-child pattern must carry its own --env-file argument, which
    // ae-mcp's command line never has.
    expect(patternBlock).toContain("--env-file=.env dist\\index.js");
  });

  it("never references Adobe, After Effects, aerender, or ae-mcp anywhere near the process-kill logic", () => {
    const killFnIndex = updateCodeBody.indexOf("function Stop-DyoWorkerProcessesForcibly");
    expect(killFnIndex).toBeGreaterThan(-1);
    const block = updateCodeBody.slice(killFnIndex, killFnIndex + 800);
    expect(block).not.toMatch(/adobe/i);
    expect(block).not.toMatch(/afterfx/i);
    expect(block).not.toMatch(/aerender/i);
    expect(block).not.toMatch(/ae-mcp/i);
    expect(block).not.toMatch(/creative cloud/i);
  });

  it("kills by exact PID via taskkill, never by a broad name-based kill", () => {
    expect(updateScript).toMatch(/taskkill \/F \/T \/PID \$proc\.ProcessId/);
    expect(updateScript).not.toMatch(/taskkill[^\n]*\/IM/i);
  });

  it("runs the forced-stop step before Start-ScheduledTask, and verifies exactly one supervisor remains after", () => {
    const stopCallIndex = updateScript.indexOf("Stop-DyoWorkerProcessesForcibly");
    const secondUse = updateScript.indexOf("Stop-DyoWorkerProcessesForcibly", stopCallIndex + 1);
    expect(secondUse).toBeGreaterThan(-1);
    const startCallIndex = updateScript.indexOf("Start-ScheduledTask -TaskName $TaskName", secondUse);
    expect(startCallIndex).toBeGreaterThan(secondUse);
    const verifyIndex = updateScript.indexOf("remainingSupervisors", startCallIndex);
    expect(verifyIndex).toBeGreaterThan(startCallIndex);
    const verifyBlock = updateScript.slice(verifyIndex, verifyIndex + 500);
    expect(verifyBlock).toMatch(/-gt 1/);
    expect(verifyBlock).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-CombinedFix2-Update.ps1 never registers a new worker identity", () => {
  it("STOPs with a clear message and exits nonzero if worker-credentials.json is missing, instead of silently registering", () => {
    const credCheckIndex = updateScript.indexOf("$credentialsPath = Join-Path $WorkRoot");
    expect(credCheckIndex).toBeGreaterThan(-1);
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

describe("DYO-Worker-CombinedFix2-Update.ps1 never modifies .env, never touches ae-mcp/AE/aerender at all", () => {
  it("never writes to, rewrites, or deletes the .env file - only checks it exists", () => {
    expect(updateScript).not.toMatch(/Write-Utf8NoBomFile/);
    expect(updateScript).not.toMatch(/Set-Content[^\n]*\$envPath/);
    expect(updateScript).not.toMatch(/Remove-Item[^\n]*\$envPath/);
    expect(updateScript).toMatch(/if \(-not \(Test-Path \$envPath\)\)/);
  });

  it("excludes .env from the bulk program-file copy", () => {
    expect(updateScript).toMatch(
      /Copy-Item -Path \(Join-Path \$sourceApp "\*"\) -Destination \$InstallDir -Recurse -Force -Exclude "\.env"/
    );
  });

  it("never invokes `node` directly, never calls ae_run_jsx/aerender, and never calls any AE-touching tool", () => {
    const executableLines = updateCodeBody
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    expect(executableLines).not.toMatch(/&\s*node\b/);
    expect(executableLines).not.toMatch(/&\s*aerender/i);
    expect(executableLines).not.toMatch(/ae_run_jsx/);
    expect(executableLines).not.toMatch(/callTool/);
    expect(executableLines).not.toMatch(/HeroicSwanMcpClient/);
    expect(executableLines).not.toMatch(/HeroicSwanAeEditBridge/);
  });

  it("never mentions SET_TEXT or MAP_FOOTAGE anywhere", () => {
    expect(updateScript).not.toMatch(/SET_TEXT/);
    expect(updateScript).not.toMatch(/MAP_FOOTAGE/);
  });

  it("never opens, reads, or hardcodes an actual After Effects project path", () => {
    expect(updateCodeBody).not.toMatch(/New-Object[^\n]*\.aep/i);
    expect(updateCodeBody).not.toMatch(/\$\w+\s*=\s*"[^"]*\.aep"/i);
    expect(updateCodeBody).not.toMatch(/Test-Path[^\n]*\.aep/i);
  });
});

describe("DYO-Worker-CombinedFix2-Update.ps1 keeps runtime dependencies correct regardless of prior update history", () => {
  it("copies the full worker-app (not dist-only) and runs npm install", () => {
    expect(updateScript).toMatch(/\$sourceApp = Join-Path \$PSScriptRoot "worker-app"/);
    expect(updateScript).toMatch(/Test-Path \(Join-Path \$sourceApp "dist\\index\.js"\)/);
    expect(updateScript).toMatch(/& npm install --omit=dev --no-audit --no-fund/);
  });

  it("verifies @modelcontextprotocol/sdk actually landed in node_modules after install, and STOPs if not", () => {
    expect(updateScript).toMatch(
      /\$sdkCheckPath = Join-Path \$InstallDir "node_modules\\@modelcontextprotocol\\sdk\\package\.json"/
    );
    const idx = updateScript.indexOf("$sdkCheckPath = Join-Path");
    const block = updateScript.slice(idx, idx + 500);
    expect(block).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-CombinedFix2-Update.ps1 restarts (not re-registers) the existing Scheduled Task", () => {
  it("uses the exact TaskName \"DYO Video Worker\"", () => {
    expect(updateScript).toMatch(/\$TaskName = "DYO Video Worker"/);
  });

  it("never registers or unregisters the Scheduled Task", () => {
    expect(updateScript).not.toMatch(/Register-ScheduledTask/);
    expect(updateScript).not.toMatch(/Unregister-ScheduledTask/);
  });

  it("STOPs with a clear message if the Scheduled Task does not exist, rather than silently creating one", () => {
    const idx = updateScript.indexOf("if (-not $existingTask)");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-CombinedFix2-Update.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-CombinedFix2-Update.ps1 without asking for any input itself", () => {
    expect(updateBat).toMatch(/DYO-Worker-CombinedFix2-Update\.ps1/);
    expect(updateBat).not.toMatch(/set \/p/i);
  });
});
