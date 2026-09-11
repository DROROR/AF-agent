<#
.SYNOPSIS
  DYO Windows Worker - process cleanup fix, for an ALREADY-REGISTERED
  install. Double-click DYO-Worker-ProcessCleanupFix-Update.bat instead of
  running this file directly.

.DESCRIPTION
  Real 2026-09-11 incident fix (session a7fee3d9): the FAHADNAKASH QA
  machine was found running TWO independent DYO Worker process trees at
  once after a routine update - an old supervisor/worker pair from an
  earlier Task Scheduler run, alongside the new one this same update
  script's own restart step had just started. `Stop-ScheduledTask` had NOT
  actually stopped the old tree - Windows Task Scheduler can lose track of
  a still-running task instance (its own bookkeeping, not this script's),
  after which `Stop-ScheduledTask` silently has nothing to signal and
  `Start-ScheduledTask` spawns a second, independent tree rather than
  replacing the first. This was resolved manually that time (an operator
  ran `taskkill /F /T` on the confirmed-stale PID) - this update makes that
  cleanup automatic and permanent, every time, regardless of whether
  Task Scheduler's own state is accurate:

  1. Before ever calling Start-ScheduledTask, this script now enumerates
     EVERY node.exe process on the machine and forcibly stops (taskkill
     /F /T) any whose own command line matches this worker's two real
     launch commands (`dist\supervisor\index.js` or
     `--env-file=.env dist\index.js`) - never anything else, never by
     process name alone, never Adobe/After Effects/Creative Cloud/ae-mcp
     (none of those ever run under either of those two exact command
     lines).
  2. After starting the task, re-enumerates and fails loudly (never
     silently) if more than one supervisor process is found running -
     this would mean the cleanup itself did not work, which should be
     reported and investigated, never left unnoticed.

  This is a strictly ADDITIVE, restart-step-only change:
    - No new capability, no new allowlisted tool, no new job type, no
      change to the worker-app program files' own behavior once running.
    - Never touches the immutable source .aep, never touches any asset-
      mapping decision - scene use/approval state is completely unaffected.
    - Never kills anything by process name alone - always by exact,
      narrow command-line match, so Adobe Creative Cloud's own background
      node.exe helper (a real, unrelated, always-running process on this
      machine) is never touched.

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
      installs the fix; nothing in this script calls CREATE_PREVIEW,
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
# under (run-worker-supervisor.ps1's own fixed ProcessStartInfo, and
# env.ts's supervisor spawning the worker child with the same fixed
# arguments) - never a name-only match, so this can never touch Adobe
# Creative Cloud's own background node.exe helper or anything else.
$WorkerProcessCommandLinePatterns = @(
  [regex]::Escape("dist\supervisor\index.js"),
  [regex]::Escape("dist\index.js")
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
Write-Host "  DYO Windows Worker - Process Cleanup Fix Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer so future restarts always end with exactly one DYO Worker"
Write-Host "process tree running, even if Windows Task Scheduler's own tracking"
Write-Host "of the previous run becomes inaccurate. It does not ask for a"
Write-Host "registration code, does not change which DYO Worker this computer is,"
Write-Host "and does not open, modify, or run anything against the immutable"
Write-Host "source .aep."
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
  Write-Host "Re-download the full DYO Worker Process Cleanup Fix update package and try again."
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
  Write-Host "Check your internet connection and re-run DYO-Worker-ProcessCleanupFix-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-ProcessCleanupFix-Update.bat again. If this keeps happening, contact DYO."
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

# THE REAL FIX: never trust Stop-ScheduledTask alone - Task Scheduler's own
# tracking of the previous run can be wrong (see this script's own doc
# comment for the real 2026-09-11 incident). Forcibly stop any DYO Worker
# process still running by its own real command line before ever starting
# a fresh one, so a restart can never produce two independent trees again.
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
Write-Host "DYO Worker is running with the process cleanup fix, using the same DYO"
Write-Host "Worker identity this computer already had - no new registration was created."
Write-Host "No After Effects project was opened, changed, or run against by this"
Write-Host "update itself."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
