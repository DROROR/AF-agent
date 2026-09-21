import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const deployDir = join(currentDir, "..", "..", "..", "deploy", "windows-worker");

const updateScript = readFileSync(join(deployDir, "DYO-Worker-SlotSemantics-Update.ps1"), "utf8");
const updateBat = readFileSync(join(deployDir, "DYO-Worker-SlotSemantics-Update.bat"), "utf8");
const readme = readFileSync(join(deployDir, "SLOTSEMANTICS-UPDATE-README.txt"), "utf8");

/** Everything after the help block - what actually executes on the client machine. */
const updateCodeBody = updateScript.slice(updateScript.indexOf("#>") + 2);

/**
 * The release installer for build 8f3568a (safe inspections, slot semantics,
 * measured asset facts). It is the same proven installer every prior
 * *-Update.ps1 in this folder uses; these tests assert the guarantees that
 * matter are still true of THIS copy, rather than trusting that it was
 * derived from a safe one.
 */
describe("DYO-Worker-SlotSemantics-Update.ps1 preserves this computer's worker identity", () => {
  it("never reads, writes or re-registers the worker's credentials - only checks the file exists", () => {
    expect(updateCodeBody).toContain("worker-credentials.json");
    expect(updateCodeBody).not.toMatch(/Get-Content[^\n]*worker-credentials\.json/);
    expect(updateCodeBody).not.toMatch(/ConvertFrom-Json[^\n]*worker-credentials/);
    expect(updateCodeBody).not.toMatch(/\bWORKER_ID\b|\bWORKER_TOKEN\b/);
  });

  it("stops rather than silently registering when the credentials file is missing", () => {
    const guard = updateCodeBody.slice(updateCodeBody.indexOf("worker-credentials.json"));
    expect(guard).toMatch(/exit 1/);
  });

  it("never registers or unregisters the Scheduled Task - it only restarts the existing one", () => {
    expect(updateCodeBody).not.toMatch(/Register-ScheduledTask|Unregister-ScheduledTask/);
    expect(updateCodeBody).toMatch(/Start-ScheduledTask/);
  });

  it("never rewrites or deletes .env - the API URL, AE paths and work root stay exactly as they are", () => {
    expect(updateCodeBody).toMatch(/-Exclude "\.env"/);
    expect(updateCodeBody).not.toMatch(/Set-Content[^\n]*\.env|Remove-Item[^\n]*\.env\b/);
  });

  it("never prompts for anything", () => {
    expect(updateCodeBody).not.toMatch(/Read-Host/);
  });
});

describe("DYO-Worker-SlotSemantics-Update.ps1 never touches After Effects or any project", () => {
  it("opens, renders and inspects nothing - it only replaces program files", () => {
    // Actions, not words: the installer may PROMISE not to touch a project in
    // a message, but it must never invoke a renderer, start After Effects, or
    // run a script inside it.
    const actions = updateCodeBody
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#") && !line.includes("Write-Host"))
      .join("\n");
    expect(actions).not.toMatch(/aerender|AfterFX|ae_run_jsx|ae_open_project/i);
    expect(actions).not.toMatch(/\.aep\b/i);
  });

  it("says so plainly to the operator, in the script and in the README", () => {
    expect(updateScript).toMatch(/never opens, inspects, modifies or\s+renders any After Effects project/i);
    expect(readme).toMatch(/No After Effects project is opened, inspected, changed or rendered/i);
  });

  it("only ever stops this worker's own two known command lines, never a process by name", () => {
    expect(updateScript).toMatch(/\[regex\]::Escape\("dist\\supervisor\\index\.js"\)/);
    expect(updateScript).toMatch(/\[regex\]::Escape\("--env-file=\.env dist\\index\.js"\)/);
    // The bare tail would also match ae-mcp's own process (2026-09-12 incident).
    const patterns = updateScript.slice(updateScript.indexOf("$WorkerProcessCommandLinePatterns"));
    expect(patterns.slice(0, 400)).not.toMatch(/Escape\("dist\\index\.js"\)/);
  });
});

describe("DYO-Worker-SlotSemantics-Update.ps1 can always be rolled back", () => {
  it("backs the current program files up BEFORE replacing them", () => {
    const backupAt = updateCodeBody.indexOf("dist.backup-");
    const copyAt = updateCodeBody.indexOf("Copy-Item -Path (Join-Path $sourceApp");
    expect(backupAt).toBeGreaterThan(-1);
    expect(copyAt).toBeGreaterThan(backupAt);
  });

  it("backs up and restores BUILD_INFO.json together with dist, so the logged commit can never disagree with the running code", () => {
    expect(updateCodeBody).toMatch(/BUILD_INFO\.json/);
    const restore = updateCodeBody.slice(updateCodeBody.indexOf("function Restore-BackupAndRestart"));
    expect(restore.slice(0, 900)).toMatch(/BUILD_INFO\.json/);
  });

  it("restores that backup automatically when the worker does not come back healthy", () => {
    expect(updateCodeBody).toMatch(/Wait-ForHealthyWorkerTree/);
    expect(updateCodeBody).toMatch(/Restore-BackupAndRestart -BackupDir \$backupDir/);
  });

  it("proves THIS release's own files physically landed before restarting or claiming success", () => {
    const markers = updateCodeBody.slice(updateCodeBody.indexOf("$newBuildMarkers"), updateCodeBody.indexOf("foreach ($marker in $newBuildMarkers)"));
    // Files that exist only in this build - a stale payload cannot pass these.
    expect(markers).toContain("dist\\inspection\\disposable-project.js");
    expect(markers).toContain("dist\\inspection\\build-slot-facts.js");
    expect(markers).toContain("schemas\\dist\\slot-semantics.js");
    expect(markers).toContain("schemas\\dist\\slot-readiness.js");
    // The LAST Start-ScheduledTask is the real restart; earlier ones belong to
    // the rollback helper, which is deliberately defined before it is used.
    const verifyAt = updateCodeBody.indexOf("$newBuildMarkers");
    const restartAt = updateCodeBody.lastIndexOf("Start-ScheduledTask");
    expect(verifyAt).toBeLessThan(restartAt);
  });

  it("never deletes the .env or the worker's state directory while rolling back - only the dist folder it replaced", () => {
    const restore = updateCodeBody.slice(updateCodeBody.indexOf("function Restore-BackupAndRestart"));
    const body = restore.slice(0, restore.indexOf("\n}"));
    expect(body).not.toMatch(/Remove-Item[^\n]*\$InstallDir"?\s*$/m);
    expect(body).not.toMatch(/\.env/);
  });
});

describe("DYO-Worker-SlotSemantics-Update packaging", () => {
  it("the launcher runs this release's own script, not a previous release's", () => {
    expect(updateBat).toContain("DYO-Worker-SlotSemantics-Update.ps1");
    expect(updateBat).not.toMatch(/RemoteDiagnostics|StartupRecovery|CombinedFix/);
  });

  it("no operator-facing message still names a previous release", () => {
    const messages = updateCodeBody
      .split("\n")
      .filter((line) => line.includes("Write-Host"))
      .join("\n");
    expect(messages).not.toMatch(/RemoteDiagnostics|StartupRecovery|combined fixes/i);
  });

  it("names the exact build it ships, so a machine's version can be confirmed against the release notes", () => {
    expect(updateScript).toContain("8f3568a");
    expect(readme).toContain("8f3568a104a6dfb5c14a0497710058249ea9256f");
  });
});
