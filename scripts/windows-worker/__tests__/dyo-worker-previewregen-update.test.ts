import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-PreviewRegen-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-PreviewRegen-Update.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN/EXECUTE_FRAME in prose. "Never appears in the
// code" assertions below check only the executable body.
const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

/**
 * DYO-Worker-PreviewRegen-Update.ps1 ships First Preview regeneration
 * schema support (real incident, 2026-09-09: the Worker on this machine
 * rejected a previewOnly job the API had already correctly dispatched,
 * because its own build predated the feature) to an already-registered
 * client in one click. These tests assert the same safety properties
 * every prior *-Update.ps1 in this folder guarantees: preserved worker
 * identity, no registration flow, no .env rewrite, and no ae-mcp command
 * of any kind run by this script itself - only DYO Worker's own program
 * files are updated and the same Scheduled Task is restarted.
 */
describe("DYO-Worker-PreviewRegen-Update.ps1 never registers a new worker identity", () => {
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

describe("DYO-Worker-PreviewRegen-Update.ps1 never modifies .env, never touches ae-mcp/AE at all", () => {
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

  it("never invokes `node`, never calls EXECUTE_FRAME, ae_run_jsx, or any AE-mutating tool in its executable body - it only installs the fix, never invokes it", () => {
    const executableLines = updateCodeBody
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    expect(executableLines).not.toMatch(/&\s*node\b/);
    expect(executableLines).not.toMatch(/EXECUTE_FRAME/);
    expect(executableLines).not.toMatch(/ae_run_jsx/);
    expect(executableLines).not.toMatch(/callTool/);
    expect(executableLines).not.toMatch(/HeroicSwanMcpClient/);
    expect(executableLines).not.toMatch(/HeroicSwanAeEditBridge/);
  });

  it("never opens, reads, or hardcodes an actual After Effects project path", () => {
    expect(updateCodeBody).not.toMatch(/\.aep\b/i);
  });
});

describe("DYO-Worker-PreviewRegen-Update.ps1 keeps runtime dependencies correct regardless of prior update history", () => {
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

describe("DYO-Worker-PreviewRegen-Update.ps1 restarts (not re-registers) the existing Scheduled Task", () => {
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

describe("DYO-Worker-PreviewRegen-Update.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-PreviewRegen-Update.ps1 without asking for any input itself", () => {
    expect(updateBat).toMatch(/DYO-Worker-PreviewRegen-Update\.ps1/);
    expect(updateBat).not.toMatch(/set \/p/i);
  });
});
