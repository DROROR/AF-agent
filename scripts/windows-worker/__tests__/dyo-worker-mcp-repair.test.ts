import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const mcpRepairScript = readFileSync(join(deployDir, "DYO-Worker-MCP-Repair.ps1"), "utf8");
const mcpRepairBat = readFileSync(join(deployDir, "DYO-Worker-MCP-Repair.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN/the old wrong paths in prose. "Never appears in
// the code" assertions below check only the executable body.
const mcpRepairCodeBody = mcpRepairScript.slice(mcpRepairScript.indexOf("#>") + 2);

/**
 * DYO-Worker-MCP-Repair.ps1 is the smallest-possible fix for an
 * already-registered client: it exists purely to ship the corrected
 * ae-mcp discovery logic (compiled into dist/) without touching .env,
 * without running npm install, and without any registration flow.
 */
describe("DYO-Worker-MCP-Repair.ps1 never registers a new worker identity", () => {
  it("STOPs with a clear message and exits nonzero if worker-credentials.json is missing, instead of silently registering", () => {
    const credCheckIndex = mcpRepairScript.indexOf("$credentialsPath = Join-Path $WorkRoot");
    expect(credCheckIndex, "credentials existence check not found").toBeGreaterThan(-1);
    const block = mcpRepairScript.slice(credCheckIndex, credCheckIndex + 700);
    expect(block).toMatch(/if \(-not \(Test-Path \$credentialsPath\)\)/);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/never registers/i);
  });

  it("never opens, reads, or parses worker-credentials.json - only checks that it exists", () => {
    expect(mcpRepairScript).not.toMatch(/Get-Content[^\n]*worker-credentials/);
    expect(mcpRepairScript).not.toMatch(/ConvertFrom-Json/);
  });

  it("never prompts for anything - no Read-Host anywhere", () => {
    expect(mcpRepairScript).not.toMatch(/Read-Host/);
  });

  it("never references WORKER_ID, WORKER_TOKEN, or a registration secret in its executable body", () => {
    expect(mcpRepairCodeBody).not.toMatch(/WORKER_ID/);
    expect(mcpRepairCodeBody).not.toMatch(/WORKER_TOKEN/);
    expect(mcpRepairCodeBody).not.toMatch(/WORKER_REGISTRATION_SECRET/);
    expect(mcpRepairCodeBody).not.toMatch(/registerWorker/);
  });
});

describe("DYO-Worker-MCP-Repair.ps1 is the smallest possible fix: no .env changes, no npm install", () => {
  it("never writes to, rewrites, or deletes the .env file - only checks it exists", () => {
    expect(mcpRepairScript).not.toMatch(/Write-Utf8NoBomFile/);
    expect(mcpRepairScript).not.toMatch(/Set-Content[^\n]*\$envPath/);
    expect(mcpRepairScript).not.toMatch(/Remove-Item[^\n]*\$envPath/);
    expect(mcpRepairScript).toMatch(/if \(-not \(Test-Path \$envPath\)\)/);
  });

  it("never runs npm install - nothing new needs to be installed for this fix", () => {
    // "npm install" is mentioned in the header doc comment contrasting
    // this script with DYO-Worker-Repair.ps1 - assert no actual invocation
    // exists in the executable body.
    expect(mcpRepairCodeBody).not.toMatch(/&\s*npm install/);
    expect(mcpRepairCodeBody).not.toMatch(/npm install --omit-dev/);
  });

  it("only copies dist/ (compiled program files), not the whole worker-app tree", () => {
    expect(mcpRepairScript).toMatch(/\$sourceDist = Join-Path \$PSScriptRoot "worker-app\\dist"/);
    expect(mcpRepairScript).toMatch(/\$destDist = Join-Path \$InstallDir "dist"/);
    expect(mcpRepairScript).toMatch(/Copy-Item -Path \(Join-Path \$sourceDist "\*"\) -Destination \$destDist -Recurse -Force/);
  });

  it("requires InstallDir to already exist - refuses to run as a substitute for first-time setup", () => {
    const checkIndex = mcpRepairScript.indexOf("if (-not (Test-Path $InstallDir))");
    expect(checkIndex).toBeGreaterThan(-1);
    const block = mcpRepairScript.slice(checkIndex, checkIndex + 400);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/DYO-Worker-Setup\.bat/);
  });
});

describe("DYO-Worker-MCP-Repair.ps1 restarts the existing Scheduled Task, by the same name Setup.ps1 uses", () => {
  it("uses the exact TaskName \"DYO Video Worker\"", () => {
    expect(mcpRepairScript).toMatch(/\$TaskName = "DYO Video Worker"/);
  });

  it("stops the task if running, then starts it again, rather than re-registering it", () => {
    expect(mcpRepairScript).not.toMatch(/Register-ScheduledTask/);
    expect(mcpRepairScript).not.toMatch(/Unregister-ScheduledTask/);
    expect(mcpRepairScript).toMatch(/Stop-ScheduledTask -TaskName \$TaskName/);
    expect(mcpRepairScript).toMatch(/Start-ScheduledTask -TaskName \$TaskName/);
  });

  it("STOPs with a clear message if the Scheduled Task does not exist, rather than silently creating one", () => {
    const idx = mcpRepairScript.indexOf("if (-not $existingTask)");
    expect(idx).toBeGreaterThan(-1);
    const block = mcpRepairScript.slice(idx, idx + 400);
    expect(block).toMatch(/exit 1/);
  });
});

describe("DYO-Worker-MCP-Repair.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-MCP-Repair.ps1 without asking for any input itself", () => {
    expect(mcpRepairBat).toMatch(/DYO-Worker-MCP-Repair\.ps1/);
    expect(mcpRepairBat).not.toMatch(/set \/p/i);
  });
});
