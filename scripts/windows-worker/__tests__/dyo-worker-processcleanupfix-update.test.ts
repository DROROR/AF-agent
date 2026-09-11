import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-ProcessCleanupFix-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-ProcessCleanupFix-Update.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN/CREATE_PREVIEW/RENDER/EXECUTE_FRAME/
// INSPECT_SCENE_EVIDENCE in prose. "Never appears in the code" assertions
// below check only the executable body.
const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

/**
 * DYO-Worker-ProcessCleanupFix-Update.ps1 (real 2026-09-11 incident fix):
 * a restart must never be able to leave two DYO Worker process trees
 * running, and the forced-stop step it adds must never be able to touch
 * anything other than DYO Worker's own two known launch command lines -
 * never Adobe/After Effects/Creative Cloud/ae-mcp, never a name-only
 * process match.
 */
describe("DYO-Worker-ProcessCleanupFix-Update.ps1 only ever targets DYO Worker's own two known command lines", () => {
  it("matches processes by exact command-line substring, never by process name alone", () => {
    expect(updateScript).toMatch(/\[regex\]::Escape\("dist\\supervisor\\index\.js"\)/);
    expect(updateScript).toMatch(/\[regex\]::Escape\("dist\\index\.js"\)/);
    const filterIndex = updateScript.indexOf("function Get-DyoWorkerProcesses");
    expect(filterIndex).toBeGreaterThan(-1);
    const block = updateScript.slice(filterIndex, filterIndex + 500);
    expect(block).toMatch(/Where-Object/);
    expect(block).toMatch(/cmd -match \$pattern/);
  });

  it("never references Adobe, After Effects, aerender, or ae-mcp anywhere near the process-kill logic - it can never match them", () => {
    const killFnIndex = updateCodeBody.indexOf("function Stop-DyoWorkerProcessesForcibly");
    expect(killFnIndex).toBeGreaterThan(-1);
    const block = updateCodeBody.slice(killFnIndex, killFnIndex + 800);
    expect(block).not.toMatch(/adobe/i);
    expect(block).not.toMatch(/afterfx/i);
    expect(block).not.toMatch(/aerender/i);
    expect(block).not.toMatch(/ae-mcp/i);
    expect(block).not.toMatch(/creative cloud/i);
  });

  it("kills by exact PID via taskkill, never by a broad name-based kill (e.g. `taskkill /IM node.exe`)", () => {
    expect(updateScript).toMatch(/taskkill \/F \/T \/PID \$proc\.ProcessId/);
    expect(updateScript).not.toMatch(/taskkill[^\n]*\/IM/i);
  });

  it("runs the forced-stop step before Start-ScheduledTask, and verifies exactly one supervisor remains after", () => {
    const stopCallIndex = updateScript.indexOf("Stop-DyoWorkerProcessesForcibly");
    const secondUse = updateScript.indexOf("Stop-DyoWorkerProcessesForcibly", stopCallIndex + 1);
    expect(secondUse, "Stop-DyoWorkerProcessesForcibly must actually be invoked, not just defined").toBeGreaterThan(-1);
    const startCallIndex = updateScript.indexOf("Start-ScheduledTask -TaskName $TaskName", secondUse);
    expect(startCallIndex, "Start-ScheduledTask must be called after the forced-stop step").toBeGreaterThan(secondUse);

    const verifyIndex = updateScript.indexOf("remainingSupervisors", startCallIndex);
    expect(verifyIndex, "must verify exactly one supervisor remains after restart").toBeGreaterThan(startCallIndex);
    const verifyBlock = updateScript.slice(verifyIndex, verifyIndex + 500);
    expect(verifyBlock).toMatch(/-gt 1/);
    expect(verifyBlock).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-ProcessCleanupFix-Update.ps1 never registers a new worker identity", () => {
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

describe("DYO-Worker-ProcessCleanupFix-Update.ps1 never modifies .env, never touches ae-mcp/AE/aerender at all", () => {
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

  it("never mentions SET_TEXT or MAP_FOOTAGE anywhere - this update has nothing to do with either of them", () => {
    expect(updateScript).not.toMatch(/SET_TEXT/);
    expect(updateScript).not.toMatch(/MAP_FOOTAGE/);
  });

  it("never opens, reads, or hardcodes an actual After Effects project path", () => {
    expect(updateCodeBody).not.toMatch(/New-Object[^\n]*\.aep/i);
    expect(updateCodeBody).not.toMatch(/\$\w+\s*=\s*"[^"]*\.aep"/i);
    expect(updateCodeBody).not.toMatch(/Test-Path[^\n]*\.aep/i);
  });
});

describe("DYO-Worker-ProcessCleanupFix-Update.ps1 keeps runtime dependencies correct regardless of prior update history", () => {
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

describe("DYO-Worker-ProcessCleanupFix-Update.ps1 restarts (not re-registers) the existing Scheduled Task", () => {
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

describe("DYO-Worker-ProcessCleanupFix-Update.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-ProcessCleanupFix-Update.ps1 without asking for any input itself", () => {
    expect(updateBat).toMatch(/DYO-Worker-ProcessCleanupFix-Update\.ps1/);
    expect(updateBat).not.toMatch(/set \/p/i);
  });
});
