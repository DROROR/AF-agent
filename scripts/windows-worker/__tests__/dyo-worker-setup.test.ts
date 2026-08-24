import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const setupScript = readFileSync(join(deployDir, "DYO-Worker-Setup.ps1"), "utf8");
const startBat = readFileSync(join(deployDir, "DYO-Worker-Start.bat"), "utf8");
const runWorkerBat = readFileSync(join(currentDir, "..", "..", "windows-worker-run-wrapper.bat"), "utf8");

/**
 * Regression coverage for a real client failure: "Worker configuration
 * error: DYO_API_URL / Required / received: undefined" reached a real
 * Windows machine after registration otherwise appeared to succeed. These
 * tests assert the specific properties that must hold for that class of
 * failure to be caught before Node ever runs, and for the three separate
 * places that launch the worker (first registration, manual start,
 * scheduled-task auto-start) to agree on where its configuration lives.
 */
describe("DYO-Worker-Setup.ps1 writes a complete .env before ever launching the worker", () => {
  it("DYO_API_URL must be present before worker registration starts", () => {
    const envWriteIndex = setupScript.indexOf("$envLines = @(");
    const registrationLaunchIndex = setupScript.indexOf('Start-Process -FilePath "node"');
    expect(envWriteIndex, "could not find the .env write block").toBeGreaterThan(-1);
    expect(registrationLaunchIndex, "could not find the registration node launch").toBeGreaterThan(-1);

    // The line that writes DYO_API_URL must appear in source order before
    // Node is ever launched for the first-registration verification run.
    expect(envWriteIndex).toBeLessThan(registrationLaunchIndex);
    const envBlock = setupScript.slice(envWriteIndex, registrationLaunchIndex);
    expect(envBlock).toMatch(/"DYO_API_URL=\$ApiUrl"/);
  });

  it("writes all three required non-secret configuration values unconditionally", () => {
    for (const line of ['"DYO_API_URL=$ApiUrl"', '"AE_MCP_PATH=$AeMcpPath"', '"AE_MCP_INSTANCE_FILE_PATH=$InstanceFilePath"']) {
      expect(setupScript).toContain(line);
    }
  });

  it("validates the written .env is complete before launching Node for registration - fails fast with a clear message otherwise", () => {
    const validationIndex = setupScript.indexOf("Fail-fast validation");
    const registrationLaunchIndex = setupScript.indexOf('Start-Process -FilePath "node"');
    expect(validationIndex, "fail-fast validation block not found").toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(registrationLaunchIndex);

    // Checks the file it actually wrote to disk, not just its in-memory
    // representation - catches a write that silently failed too.
    expect(setupScript).toMatch(/\$writtenEnvLines = Get-Content -Path \$envPath/);
    expect(setupScript).toMatch(/"DYO_API_URL", "AE_MCP_PATH", "AE_MCP_INSTANCE_FILE_PATH"/);
    expect(setupScript).toMatch(/missingKeys\.Count -gt 0/);
    expect(setupScript).toMatch(/exit 1/);
  });

  it("the fail-fast validation message never contains the literal word 'secret value' or the registration code itself", () => {
    const validationIndex = setupScript.indexOf("Fail-fast validation");
    const nextSectionIndex = setupScript.indexOf("Registering this computer with DYO");
    const validationBlock = setupScript.slice(validationIndex, nextSectionIndex);
    // The block may reference the *name* WORKER_REGISTRATION_SECRET (a key,
    // safe to show) but must never interpolate $registrationSecret itself.
    expect(validationBlock).not.toMatch(/\$registrationSecret\b/);
  });

  it("never uses a same-file Get-Content | ... | Set-Content pipeline (can truncate the file mid-read)", () => {
    expect(setupScript).not.toMatch(/Get-Content[^\n]*\|[^\n]*Set-Content \$envPath/);
    expect(setupScript).not.toMatch(/\(Get-Content \$envPath\)[^\n]*\|[^\n]*Set-Content/);
  });

  it("strips WORKER_REGISTRATION_SECRET via a two-statement read-then-write, not a single same-file pipeline", () => {
    expect(setupScript).toMatch(/function Remove-RegistrationSecretFromEnv/);
    expect(setupScript).toMatch(/\$remainingLines = Get-Content -Path \$Path/);
    expect(setupScript).toMatch(/Set-Content -Path \$Path -Value \$remainingLines/);
  });
});

describe("first registration, manual start, and scheduled-task auto-start all target the same install directory", () => {
  it("DYO-Worker-Setup.ps1 defaults InstallDir to C:\\DYO-Agent\\app", () => {
    expect(setupScript).toMatch(/\[string\]\$InstallDir = "C:\\DYO-Agent\\app"/);
  });

  it("the registration verification run uses -WorkingDirectory $InstallDir", () => {
    expect(setupScript).toMatch(/-WorkingDirectory \$InstallDir/);
  });

  it("the scheduled task action points at run-worker.bat inside $InstallDir with -WorkingDirectory $InstallDir", () => {
    expect(setupScript).toMatch(/\$runWorkerBat = Join-Path \$InstallDir "run-worker\.bat"/);
    expect(setupScript).toMatch(/New-ScheduledTaskAction -Execute \$runWorkerBat -WorkingDirectory \$InstallDir/);
  });

  it("DYO-Worker-Start.bat hardcodes the identical install directory", () => {
    expect(startBat).toMatch(/set "INSTALL_DIR=C:\\DYO-Agent\\app"/);
  });

  it("run-worker.bat resolves its own directory (self-relative) rather than a separately-hardcoded path, so it is correct wherever it is installed", () => {
    expect(runWorkerBat).toMatch(/cd \/d "%~dp0"/);
  });

  it("all three launch paths reference the exact same .env filename with no path prefix mismatch", () => {
    // Setup.ps1's verification run and run-worker.bat both invoke Node from
    // inside $InstallDir and reference ".env" as a bare relative filename -
    // if either used a different relative depth or an absolute path to a
    // different location, this would silently diverge.
    expect(setupScript).toMatch(/"--env-file=\.env", "dist\\index\.js"/);
    expect(runWorkerBat).toMatch(/node --env-file=\.env dist\\index\.js/);
    expect(startBat).toMatch(/node --env-file=\.env dist\\index\.js/);
  });
});
