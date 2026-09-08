import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-TextLayerDiscovery-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-TextLayerDiscovery-Update.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN in prose. "Never appears in the code" assertions
// below check only the executable body.
const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

/**
 * DYO-Worker-TextLayerDiscovery-Update.ps1 ships the real, generic AE
 * layer-classification/text-discovery capability to an already-registered
 * client in one click. Mirrors DYO-Worker-Phase5-Update.ps1's own proven
 * safety properties exactly: preserved worker identity, no registration
 * flow, no .env rewrite, and no ae-mcp command of any kind run by this
 * script itself, so there is no path by which it could ever touch ae-mcp
 * or an AE project.
 */
describe("DYO-Worker-TextLayerDiscovery-Update.ps1 never registers a new worker identity", () => {
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

  it("never rewrites .env - the program-file copy explicitly excludes it", () => {
    const copyIndex = updateScript.indexOf("Copy-Item -Path (Join-Path $sourceApp");
    expect(copyIndex).toBeGreaterThan(-1);
    expect(updateScript.slice(copyIndex, copyIndex + 200)).toMatch(/-Exclude "\.env"/);
  });

  it("never calls any ae_ MCP tool or opens an AE project - this update only copies files and restarts the Scheduled Task", () => {
    expect(updateCodeBody).not.toMatch(/ae_run_jsx|ae_get_composition|ae_get_layer|ae_health|ae_list_compositions|ae_capture_frame/);
  });

  it("restarts the SAME Scheduled Task DYO-Worker-Setup.ps1 already registered, never creates a new one", () => {
    expect(updateScript).toMatch(/\$TaskName = "DYO Video Worker"/);
    expect(updateCodeBody).not.toMatch(/Register-ScheduledTask/);
    expect(updateCodeBody).toMatch(/Start-ScheduledTask -TaskName \$TaskName/);
  });

  it("the .bat launcher only invokes the matching .ps1 with no extra arguments, never asks for input itself", () => {
    expect(updateBat).toMatch(/DYO-Worker-TextLayerDiscovery-Update\.ps1/);
    expect(updateBat).not.toMatch(/set\s*\/p/i);
  });
});
