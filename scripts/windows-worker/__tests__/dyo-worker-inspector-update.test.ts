import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-Inspector-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-Inspector-Update.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN/INSPECT_TEMPLATE in prose. "Never appears in the
// code" assertions below check only the executable body.
const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

/**
 * DYO-Worker-Inspector-Update.ps1 ships the real ae-mcp health + read-only
 * inspection transport to an already-registered client in one click. These
 * tests assert the specific safety properties required: preserved worker
 * identity, no registration flow, no .env rewrite, and no path by which it
 * could ever execute INSPECT_TEMPLATE or any AE-mutating tool itself.
 */
describe("DYO-Worker-Inspector-Update.ps1 never registers a new worker identity", () => {
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

describe("DYO-Worker-Inspector-Update.ps1 never modifies .env or AE projects", () => {
  it("never writes to, rewrites, or deletes the .env file - only reads AE_MCP_PATH back from it", () => {
    expect(updateScript).not.toMatch(/Write-Utf8NoBomFile/);
    expect(updateScript).not.toMatch(/Set-Content[^\n]*\$envPath/);
    expect(updateScript).not.toMatch(/Remove-Item[^\n]*\$envPath/);
    expect(updateScript).toMatch(/if \(-not \(Test-Path \$envPath\)\)/);
    expect(updateScript).toMatch(
      /Get-Content -Path \$envPath \| Where-Object \{ \$_ -match '\^AE_MCP_PATH='/
    );
  });

  it("excludes .env from the bulk program-file copy", () => {
    expect(updateScript).toMatch(
      /Copy-Item -Path \(Join-Path \$sourceApp "\*"\) -Destination \$InstallDir -Recurse -Force -Exclude "\.env"/
    );
  });

  it("never calls INSPECT_TEMPLATE, ae_run_jsx, or any AE-mutating tool - it only installs the transport, never invokes it", () => {
    expect(updateCodeBody).not.toMatch(/INSPECT_TEMPLATE/);
    expect(updateCodeBody).not.toMatch(/ae_run_jsx/);
    expect(updateCodeBody).not.toMatch(/callTool/);
    expect(updateCodeBody).not.toMatch(/HeroicSwanMcpClient/);
    // The only ae-mcp command this script itself ever runs is the fixed,
    // read-only "health" smoke test - never "serve" (the MCP transport
    // subcommand). "server" (e.g. "server-side") legitimately appears in
    // prose, so this checks for the actual subcommand argument, not the
    // bare substring.
    expect(updateCodeBody).not.toMatch(/index\.js["'\s]+serve\b/);
  });
});

describe("DYO-Worker-Inspector-Update.ps1 installs the new @modelcontextprotocol/sdk dependency", () => {
  it("copies the full worker-app (not dist-only), since a real new dependency needs installing this time", () => {
    expect(updateScript).toMatch(/\$sourceApp = Join-Path \$PSScriptRoot "worker-app"/);
    expect(updateScript).toMatch(/Test-Path \(Join-Path \$sourceApp "dist\\index\.js"\)/);
  });

  it("runs npm install --omit=dev after copying program files", () => {
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

describe("DYO-Worker-Inspector-Update.ps1 verifies and smoke-tests ae-mcp using the exact fixed health command", () => {
  it("checks for <configured AE_MCP_PATH>\\dist\\index.js, informationally (not a hard blocker)", () => {
    expect(updateScript).toMatch(/\$aeMcpEntryPoint = Join-Path \$configuredAeMcpPath "dist\\index\.js"/);
    const idx = updateScript.indexOf("if (Test-Path $aeMcpEntryPoint)");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 300);
    expect(block).not.toMatch(/exit 1/);
  });

  it("runs the exact fixed command `node <entry point> health` - never a shell string, never extra arguments", () => {
    expect(updateScript).toMatch(/& node \$aeMcpEntryPoint health/);
  });

  it("maps exit code 0/1/other to Online/Offline/Unknown the same way the worker itself does", () => {
    const idx = updateScript.indexOf("switch ($healthExitCode)");
    expect(idx).toBeGreaterThan(-1);
    const block = updateScript.slice(idx, idx + 500);
    expect(block).toMatch(/0 \{ Write-CheckResult \$true "ae-mcp health"/);
    expect(block).toMatch(/1 \{ Write-CheckResult \$false "ae-mcp health"/);
    expect(block).toMatch(/default \{ Write-CheckResult \$false "ae-mcp health"/);
  });
});

describe("DYO-Worker-Inspector-Update.ps1 restarts (not re-registers) the existing Scheduled Task", () => {
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

describe("DYO-Worker-Inspector-Update.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-Inspector-Update.ps1 without asking for any input itself", () => {
    expect(updateBat).toMatch(/DYO-Worker-Inspector-Update\.ps1/);
    expect(updateBat).not.toMatch(/set \/p/i);
  });
});
