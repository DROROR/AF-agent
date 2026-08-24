import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const repairScript = readFileSync(join(deployDir, "DYO-Worker-Repair.ps1"), "utf8");
const repairBat = readFileSync(join(deployDir, "DYO-Worker-Repair.bat"), "utf8");

// The leading <# ... #> doc-comment block legitimately references
// WORKER_ID/WORKER_TOKEN/WORKER_REGISTRATION_SECRET/the old hardcoded
// "C:\Users\PC\..." path in prose, explaining what the script deliberately
// does NOT do. "Never appears in the code" assertions below check only the
// executable body, past that block, not the explanatory comment.
const repairCodeBody = repairScript.slice(repairScript.indexOf("#>") + 2);

/**
 * DYO-Worker-Repair.ps1 exists to ship two config fixes (AE_PATH,
 * ae-mcp instance path) to a machine that has ALREADY registered with DYO,
 * without asking for a new registration code and without ever creating a
 * second worker identity server-side. These tests assert the specific
 * safety properties that make that true, from the actual script source.
 */
describe("DYO-Worker-Repair.ps1 never registers a new worker identity", () => {
  it("STOPs with a clear message and exits nonzero if worker-credentials.json is missing, instead of silently registering", () => {
    const credCheckIndex = repairScript.indexOf("$credentialsPath = Join-Path $WorkRoot");
    expect(credCheckIndex, "credentials existence check not found").toBeGreaterThan(-1);
    const block = repairScript.slice(credCheckIndex, credCheckIndex + 900);
    expect(block).toMatch(/if \(-not \(Test-Path \$credentialsPath\)\)/);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/never registers a new/i);
  });

  it("never opens, reads, or parses worker-credentials.json - only checks that it exists", () => {
    expect(repairScript).not.toMatch(/Get-Content[^\n]*worker-credentials/);
    expect(repairScript).not.toMatch(/ConvertFrom-Json/);
  });

  it("never writes a WORKER_ID or WORKER_TOKEN line to .env - those live only in worker-credentials.json, which this script never touches", () => {
    const envLinesIndex = repairScript.indexOf("$envLines = @(");
    const envLinesEnd = repairScript.indexOf(")", envLinesIndex);
    expect(envLinesIndex, "$envLines block not found").toBeGreaterThan(-1);
    const envLinesBlock = repairScript.slice(envLinesIndex, envLinesEnd);
    expect(envLinesBlock).not.toMatch(/WORKER_ID/);
    expect(envLinesBlock).not.toMatch(/WORKER_TOKEN/);
  });

  it("never prompts for or writes a registration code - no Read-Host, and $envLines never includes a WORKER_REGISTRATION_SECRET entry", () => {
    expect(repairScript).not.toMatch(/Read-Host/);
    expect(repairCodeBody).not.toMatch(/registerWorker/);

    const envLinesIndex = repairScript.indexOf("$envLines = @(");
    const envLinesEnd = repairScript.indexOf(")", envLinesIndex);
    expect(envLinesIndex, "$envLines block not found").toBeGreaterThan(-1);
    const envLinesBlock = repairScript.slice(envLinesIndex, envLinesEnd);
    expect(envLinesBlock).not.toMatch(/WORKER_REGISTRATION_SECRET/);
  });

  it("never calls Start-Process node against dist\\index.js directly (that is the registration-verification pattern in Setup.ps1) - it only starts the worker via the Scheduled Task", () => {
    expect(repairScript).not.toMatch(/Start-Process -FilePath "node"/);
    expect(repairScript).toMatch(/Start-ScheduledTask -TaskName \$TaskName/);
  });
});

describe("DYO-Worker-Repair.ps1 preserves the existing install and configuration correctly", () => {
  it("requires InstallDir to already exist - refuses to run as a substitute for first-time setup", () => {
    const checkIndex = repairScript.indexOf("if (-not (Test-Path $InstallDir))");
    expect(checkIndex).toBeGreaterThan(-1);
    const block = repairScript.slice(checkIndex, checkIndex + 400);
    expect(block).toMatch(/exit 1/);
    expect(block).toMatch(/DYO-Worker-Setup\.bat/);
  });

  it("keeps the existing DYO_API_URL read back from the installed .env, rather than re-deriving or hardcoding it", () => {
    expect(repairScript).toMatch(/\$existingLine = Get-Content -Path \$envPath \| Where-Object \{ \$_ -match '\^DYO_API_URL='/);
    expect(repairScript).toMatch(/"DYO_API_URL=\$existingApiUrl"/);
    // No second, independent default API URL literal used for the rewritten .env.
    expect(repairScript).not.toMatch(/"DYO_API_URL=https:\/\//);
  });

  it("writes AE_PATH from a freshly-discovered $aeExePath, and stops if After Effects cannot be found (never writes a stale/guessed path)", () => {
    expect(repairScript).toMatch(/\$aeExePath = "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files\\AfterFX\.exe"/);
    expect(repairScript).toMatch(/if \(-not \(Test-Path \$aeExePath\)\)/);
    expect(repairScript).toContain('"AE_PATH=$aeExePath"');
  });

  it("derives the ae-mcp instance path from $env:USERPROFILE (current user), never a hardcoded username or the hostname", () => {
    expect(repairScript).toMatch(/\$instanceFilePath = Join-Path \$env:USERPROFILE "ae-mcp\\instances\\default\\instance\.json"/);
    // The old bug (a literal "C:\Users\PC\..." default) is referenced by
    // name in the doc comment explaining why this script exists - assert
    // it only against the executable body, not that explanatory prose.
    expect(repairCodeBody).not.toMatch(/C:\\Users\\PC\\/);
    expect(repairCodeBody).not.toMatch(/COMPUTERNAME.*instance/i);
  });

  it("writes .env via the UTF-8-no-BOM writer, never Set-Content -Encoding utf8", () => {
    expect(repairScript).toMatch(/function Write-Utf8NoBomFile/);
    expect(repairScript).toMatch(/Write-Utf8NoBomFile -Path \$envPath -Lines \$envLines/);
    expect(repairScript).not.toMatch(/^\s*Set-Content[^\n]*-Encoding utf8\b/m);
  });

  it("validates the rewritten .env is readable by the real `node --env-file=.env` mechanism before finishing", () => {
    expect(repairScript).toMatch(/function Test-WorkerEnvReadableByNode/);
    expect(repairScript).toMatch(/\$envCheck = Test-WorkerEnvReadableByNode -InstallDir \$InstallDir -RequiredKeys @\(/);
    expect(repairScript).toMatch(/if \(-not \$envCheck\.Ok\)/);
  });

  it("copies fresh program files but explicitly excludes .env from the bulk copy, so the real installed config is only ever produced by this script's own explicit write", () => {
    expect(repairScript).toMatch(/Copy-Item -Path \(Join-Path \$sourceApp "\*"\) -Destination \$InstallDir -Recurse -Force -Exclude "\.env"/);
  });
});

describe("DYO-Worker-Repair.ps1 re-registers only the existing Scheduled Task, by the same name Setup.ps1 uses", () => {
  it("uses the exact TaskName \"DYO Video Worker\" - the same one DYO-Worker-Setup.ps1/Stop.bat/Uninstall.bat use", () => {
    expect(repairScript).toMatch(/\$TaskName = "DYO Video Worker"/);
  });

  it("unregisters any existing task by that name before re-registering, rather than leaving a stale duplicate", () => {
    const idx = repairScript.indexOf("$existingTask = Get-ScheduledTask -TaskName $TaskName");
    expect(idx).toBeGreaterThan(-1);
    const block = repairScript.slice(idx, idx + 400);
    expect(block).toMatch(/Unregister-ScheduledTask -TaskName \$TaskName -Confirm:\$false/);
  });

  it("points the re-registered task at the just-updated run-worker.bat inside $InstallDir", () => {
    expect(repairScript).toMatch(/\$runWorkerBat = Join-Path \$InstallDir "run-worker\.bat"/);
    expect(repairScript).toMatch(/New-ScheduledTaskAction -Execute \$runWorkerBat -WorkingDirectory \$InstallDir/);
  });

  it("keeps the same no-stored-password AtLogOn/Interactive trigger and restart-on-failure settings as Setup.ps1", () => {
    expect(repairScript).toMatch(/New-ScheduledTaskTrigger -AtLogOn -User "\$env:USERDOMAIN\\\$env:USERNAME"/);
    expect(repairScript).toMatch(/-LogonType Interactive -RunLevel Limited/);
    expect(repairScript).toMatch(/-RestartCount 999 -RestartInterval \(New-TimeSpan -Minutes 1\)/);
  });
});

describe("DYO-Worker-Repair.bat is a thin, no-prompt launcher", () => {
  it("invokes DYO-Worker-Repair.ps1 without asking for any input itself", () => {
    expect(repairBat).toMatch(/DYO-Worker-Repair\.ps1/);
    expect(repairBat).not.toMatch(/set \/p/i);
  });
});
