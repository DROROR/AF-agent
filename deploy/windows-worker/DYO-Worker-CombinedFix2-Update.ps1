<#
.SYNOPSIS
  DYO Windows Worker - combined fix update #2, for an ALREADY-REGISTERED
  install. Double-click DYO-Worker-CombinedFix2-Update.bat instead of
  running this file directly.

.DESCRIPTION
  Ships two real 2026-09-11 fixes together, in ONE update package, rather
  than as two separate ones (per the standing instruction to batch Worker
  changes):

  1. Legacy-project-conversion detection: a real candidate template ("dro
     tempelate.aep", authored in AE 23.2.1) could not be inspected because
     it requires an interactive AE version-conversion dialog to open -
     this worker's own INSPECT_TEMPLATE deliberately suppresses ALL AE
     dialogs (so it can never get stuck behind one unattended), so the
     open silently returned with no project loaded, and the resulting
     error message did not explain why. Now, this EXACT signature (the
     open command succeeds, but AE ends up with no project associated at
     all) is generically detected for ANY template - never hardcoded to
     one file - and a disposable, deterministic copy of the source is
     automatically created under this worker's own work root (never
     touching or opening the original), with a clear message telling the
     operator exactly what to do next (open that copy in AE, resolve the
     dialog, Save As back to the same path, then re-run Inspect Template
     pointed at it).
  2. Process cleanup fix: a restart could previously leave an old DYO
     Worker process tree running alongside a newly-started one (Windows
     Task Scheduler can lose track of a still-running instance, so asking
     it to stop the old one silently did nothing). Every future restart
     now forcibly stops any process matching DYO Worker's own two known
     launch commands before starting a fresh one - never Adobe/After
     Effects/Creative Cloud/ae-mcp, never a name-only match - and verifies
     exactly one process tree remains afterward, failing loudly rather
     than leaving a silent duplicate.

  This is a strictly ADDITIVE change:
    - No new capability, no new allowlisted tool, no new job type.
    - Never touches the immutable source .aep, never touches any asset-
      mapping decision - scene use/approval state is completely unaffected.
    - Never kills anything by process name alone - always by exact,
      narrow command-line match.

  Includes `npm install` (like every prior *-Update.ps1 in this folder) so
  this update is correct and self-contained regardless of exactly which
  prior update this computer has already received. Still never touches
  .env: DYO_API_URL, AE_PATH, AE_MCP_PATH, AERENDER_PATH, and WORK_ROOT are
  all left exactly as they already are.

  Safety, same as every prior *-Update.ps1 in this folder:
    - never asks for or stores a Windows account password.
    - never asks for a registration code - if no worker-credentials.json
      is found, this STOPS with a clear message instead of silently
      registering a new, duplicate worker identity.
    - WORKER_ID/WORKER_TOKEN are never read, written, or passed as
      arguments here - this script never even opens worker-credentials.json,
      it only checks that the file exists.
    - never runs any AE-touching operation at all - this update only
      installs the fixes; nothing in this script calls CREATE_PREVIEW,
      RENDER, EXECUTE_FRAME, or INSPECT_SCENE_EVIDENCE, and never connects
      to ae-mcp.
    - installed files remain restricted (via NTFS ACLs) to the current
      Windows user and SYSTEM.

.PARAMETER InstallDir
  Where the DYO Worker program files are installed.

.PARAMETER WorkRoot
  Local folder for worker state - only used to locate worker-credentials.json.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = "C:\DYO-Agent\app",
  [string]$WorkRoot = "C:\DYO-Agent"
)

$ErrorActionPreference = "Stop"

# Must match DYO-Worker-Setup.ps1 exactly - this restarts the same OS-level
# Scheduled Task, it does not create a second one and has nothing to do
# with the worker's own identity.
$TaskName = "DYO Video Worker"

# The ONLY two real command lines this worker's own processes ever run
# under: run-worker-supervisor.ps1's fixed ProcessStartInfo
# ("node dist\supervisor\index.js"), and spawn-worker-child.ts's fixed
# argument vector ("node --env-file=.env dist\index.js", always that
# relative path preceded by --env-file).
#
# REAL BUG THIS FIXES (2026-09-12): the first version of this list matched
# the bare substring "dist\index.js", which ALSO matches ae-mcp's own
# process - the worker spawns that as
# "node <AE_MCP_PATH>\dist\index.js serve" (an ABSOLUTE path, see
# heroic-swan-mcp-client.ts's own StdioClientTransport args). The cleanup
# step therefore killed the ae-mcp bridge along with the worker, and
# ae-mcp's health probe reported the bridge disconnected (exit code 1 ->
# mcp_status OFFLINE) immediately after the update that introduced it.
# Matching on "--env-file=.env dist\index.js" is the worker child's own
# distinctive, complete form and cannot match ae-mcp, which passes no
# --env-file and always uses an absolute path plus a "serve" subcommand.
$WorkerProcessCommandLinePatterns = @(
  [regex]::Escape("dist\supervisor\index.js"),
  [regex]::Escape("--env-file=.env dist\index.js")
)

function Write-CheckResult {
  param([bool]$Ok, [string]$Label, [string]$Detail = "")
  $mark = if ($Ok) { "[OK]" } else { "[NEEDS ATTENTION]" }
  if ($Detail) {
    Write-Host "$mark $Label - $Detail"
  } else {
    Write-Host "$mark $Label"
  }
}

function Get-DyoWorkerProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) { return $false }
    foreach ($pattern in $WorkerProcessCommandLinePatterns) {
      if ($cmd -match $pattern) { return $true }
    }
    return $false
  }
}

function Stop-DyoWorkerProcessesForcibly {
  $existing = Get-DyoWorkerProcesses
  if (-not $existing -or $existing.Count -eq 0) {
    Write-CheckResult $true "No leftover DYO Worker processes found before restart"
    return
  }
  foreach ($proc in $existing) {
    Write-Host "[OK] Stopping a DYO Worker process still running from a prior task instance (PID $($proc.ProcessId))..."
    try {
      & taskkill /F /T /PID $proc.ProcessId *>$null
    } catch {
      Write-Host "[NEEDS ATTENTION] Could not stop PID $($proc.ProcessId): $($_.Exception.Message)"
    }
  }
}

Write-Host "================================================"
Write-Host "  DYO Windows Worker - Combined Fix Update #2"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer with two fixes together (legacy-project-conversion detection,"
Write-Host "and a restart process-cleanup fix). It does not ask for a registration"
Write-Host "code, does not change which DYO Worker this computer is, and does not"
Write-Host "open, modify, or run anything against the immutable source .aep."
Write-Host ""

# ---- Step 1: confirm this is actually an already-registered install ----
if (-not (Test-Path $InstallDir)) {
  Write-Host "[NEEDS ATTENTION] $InstallDir was not found."
  Write-Host "This computer has not run DYO-Worker-Setup.bat yet. Please run that first -"
  Write-Host "this script only updates an existing install, it does not create one."
  exit 1
}

$credentialsPath = Join-Path $WorkRoot "state\worker-credentials.json"
if (-not (Test-Path $credentialsPath)) {
  Write-Host "[NEEDS ATTENTION] No saved worker registration was found at:"
  Write-Host "  $credentialsPath"
  Write-Host ""
  Write-Host "This script only updates an already-registered computer - it never registers"
  Write-Host "a new one, to avoid creating a duplicate DYO Worker identity. If this computer"
  Write-Host "has never been registered, please use the full DYO Worker setup package instead."
  exit 1
}
Write-CheckResult $true "Existing DYO Worker registration found - it will be kept"

$envPath = Join-Path $InstallDir ".env"
if (-not (Test-Path $envPath)) {
  Write-Host "[NEEDS ATTENTION] No .env was found at:"
  Write-Host "  $envPath"
  Write-Host "This does not look like a complete install. Please run DYO-Worker-Setup.bat again."
  exit 1
}
Write-CheckResult $true "Existing configuration found - it will not be changed"

# ---- Step 2: update program files, including @modelcontextprotocol/sdk if not already present ----
Write-Host ""
Write-Host "Updating DYO Worker program files..."

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker Combined Fix 2 update package and try again."
  exit 1
}
Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force -Exclude ".env"
Write-CheckResult $true "Updated DYO Worker program files"

Write-Host "Checking runtime dependencies (only needs internet access if something is missing)..."
Push-Location $InstallDir
& npm install --omit=dev --no-audit --no-fund *>$null
$npmExitCode = $LASTEXITCODE
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Installing dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-CombinedFix2-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-CombinedFix2-Update.bat again. If this keeps happening, contact DYO."
  exit 1
}

# ---- Step 3: restart DYO Worker, forcibly cleaning up any stale process tree first ----
Write-Host ""
Write-Host "Restarting DYO Worker..."

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existingTask) {
  Write-Host "[NEEDS ATTENTION] The `"$TaskName`" automatic-startup task was not found."
  Write-Host "Program files were updated, but automatic startup could not be restarted."
  Write-Host "Please run DYO-Worker-Repair.bat (the full repair) instead, or contact DYO."
  exit 1
}

if ($existingTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

# Never trust Stop-ScheduledTask alone - Task Scheduler's own tracking of
# the previous run can be wrong (real 2026-09-11 incident). Forcibly stop
# any DYO Worker process still running by its own real command line before
# ever starting a fresh one, so a restart can never produce two
# independent trees again.
Stop-DyoWorkerProcessesForcibly

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5

$remainingSupervisors = @(Get-DyoWorkerProcesses | Where-Object { $_.CommandLine -match [regex]::Escape("dist\supervisor\index.js") })
if ($remainingSupervisors.Count -gt 1) {
  Write-Host "[NEEDS ATTENTION] $($remainingSupervisors.Count) DYO Worker supervisor processes are running after restart - expected exactly 1."
  Write-Host "Process IDs: $($remainingSupervisors.ProcessId -join ', ')"
  Write-Host "Please contact DYO before running any AE job - do not use this computer as-is."
  exit 1
}

Write-CheckResult $true "DYO Worker restarted with the updated program files - exactly one process tree confirmed running"

Write-Host ""
Write-Host "================================================"
Write-Host "  Update complete"
Write-Host "================================================"
Write-Host "DYO Worker is running with both combined fixes, using the same DYO"
Write-Host "Worker identity this computer already had - no new registration was created."
Write-Host "No After Effects project was opened, changed, or run against by this"
Write-Host "update itself."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
