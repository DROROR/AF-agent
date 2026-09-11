import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-ResolveCompositionById-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-ResolveCompositionById-Update.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN/CREATE_PREVIEW/RENDER/INSPECT_SCENE_EVIDENCE in
// prose. "Never appears in the code" assertions below check only the
// executable body.
const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

/**
 * DYO-Worker-ResolveCompositionById-Update.ps1 ships the fix for the
 * real 2026-09-11 incident (job 47b0b42f-bbec-4ee5-a6f1-0132591a4a89):
 * a persisted aeProjectItemIndex went stale after a later composition-
 * creating operation shifted every later project item's own position.
 * These tests assert the same safety properties every prior
 * *-Update.ps1 in this folder guarantees: preserved worker identity, no
 * registration flow, no .env rewrite, and no ae-mcp/aerender command of
 * any kind run by this script itself - only DYO Worker's own program
 * files are updated and the same Scheduled Task is restarted.
 */
describe("DYO-Worker-ResolveCompositionById-Update.ps1 never registers a new worker identity", () => {
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

describe("DYO-Worker-ResolveCompositionById-Update.ps1 never modifies .env, never touches ae-mcp/AE/aerender at all", () => {
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

  it("never invokes `node` at all, never calls ae_run_jsx/aerender, and never calls any AE-touching tool - it only installs the update, never invokes it", () => {
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

  it("never opens, reads, or hardcodes an actual After Effects project path - the one \".aep\" mention anywhere is only human-readable guidance text, never a path/File object", () => {
    expect(updateCodeBody).not.toMatch(/New-Object[^\n]*\.aep/i);
    expect(updateCodeBody).not.toMatch(/\$\w+\s*=\s*"[^"]*\.aep"/i);
    expect(updateCodeBody).not.toMatch(/Test-Path[^\n]*\.aep/i);
  });
});

describe("DYO-Worker-ResolveCompositionById-Update.ps1 keeps runtime dependencies correct regardless of prior update history", () => {
  it("copies the full worker-app (not dist-only) and runs npm install, since it cannot assume @modelcontextprotocol/sdk is already present", () => {
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

describe("DYO-Worker-ResolveCompositionById-Update.ps1 restarts (not re-registers) the existing Scheduled Task", () => {
  it("uses the exact TaskName \"DYO Video Worker\"", () => {
    expect(updateScript).toMatch(/\$TaskName = "DYO Video Worker"/);
  });

  it("stops the task if running, then starts it again, rather than re-registering it", () => {
    expect(updateScript).not.toMatch(/Register-ScheduledTask/);
    expect(updateScript).not.toMatch(/Unregister-ScheduledTask/);
    expect(updateScript).toMatch(/Stop-ScheduledTask -TaskName \$TaskName/);
    expect(updateScript).toMatch(/Start-ScheduledTask -TaskName \$TaskName/);
  });

  it("STOPs with a clear message if the Scheduled Task does not exist, rather than silently creating one", () => {
    const idx = updateScript.indexOf("if (-not $existingTask)");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 400);
    expect(block).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-ResolveCompositionById-Update.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-ResolveCompositionById-Update.ps1 without asking for any input itself", () => {
    expect(updateBat).toMatch(/DYO-Worker-ResolveCompositionById-Update\.ps1/);
    expect(updateBat).not.toMatch(/set \/p/i);
  });
});
