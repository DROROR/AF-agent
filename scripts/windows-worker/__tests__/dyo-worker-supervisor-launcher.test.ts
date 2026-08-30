import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(currentDir, "..", "..", "..", "scripts");

const launcherScript = readFileSync(join(scriptsDir, "windows-worker-supervisor-launcher.ps1"), "utf8");

describe("windows-worker-supervisor-launcher.ps1 - the hidden Scheduled Task entrypoint", () => {
  it("is fixed and deterministic - takes no parameters, never builds a command from external/dynamic input", () => {
    expect(launcherScript).not.toMatch(/param\s*\(/);
    expect(launcherScript).not.toMatch(/Read-Host/);
    expect(launcherScript).not.toMatch(/Invoke-Expression/i);
    expect(launcherScript).not.toMatch(/iex\s/i);
  });

  it("rotates any previous run's worker.log exactly once, before starting the supervisor - same behavior run-worker.bat always had", () => {
    const logCheckIdx = launcherScript.indexOf('Join-Path $PSScriptRoot "logs\\worker.log"');
    const startIdx = launcherScript.indexOf("[System.Diagnostics.Process]::Start");
    expect(logCheckIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(logCheckIdx);
    expect(launcherScript).toMatch(/Move-Item -Path \$logPath -Destination "\$logPath\.previous" -Force/);
  });

  it("starts the real Node supervisor (dist\\supervisor\\index.js) from its own directory", () => {
    expect(launcherScript).toMatch(/\$psi\.FileName = "node"/);
    expect(launcherScript).toMatch(/\$psi\.Arguments = "dist\\supervisor\\index\.js"/);
    expect(launcherScript).toMatch(/\$psi\.WorkingDirectory = \$PSScriptRoot/);
  });

  it("creates the supervisor process with NO console window and UseShellExecute disabled - the actual fix for a closable visible console killing production", () => {
    expect(launcherScript).toMatch(/\$psi\.UseShellExecute = \$false/);
    expect(launcherScript).toMatch(/\$psi\.CreateNoWindow = \$true/);
  });

  it("blocks until the supervisor exits and forwards its real exit code, same LastTaskResult contract run-worker.bat always had", () => {
    expect(launcherScript).toMatch(/\$proc\.WaitForExit\(\)/);
    expect(launcherScript).toMatch(/exit \$proc\.ExitCode/);
  });

  it("never references WORKER_ID, WORKER_TOKEN, or a registration secret", () => {
    expect(launcherScript).not.toMatch(/WORKER_ID/);
    expect(launcherScript).not.toMatch(/WORKER_TOKEN/);
    expect(launcherScript).not.toMatch(/WORKER_REGISTRATION_SECRET/);
  });

  it("never opens, reads, or references any After Effects project path", () => {
    expect(launcherScript).not.toMatch(/\.aep\b/i);
  });
});
