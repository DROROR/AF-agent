<#
.SYNOPSIS
  DYO Windows Worker - combined fix update #2, for an ALREADY-REGISTERED
  install. Double-click DYO-Worker-StartupRecovery-Update.bat instead of
  running this file directly.

.DESCRIPTION
  Fixes the 2026-09-12 release blocker where, after every Windows restart,
  a human had to open After Effects and click CONNECT in the ae-mcp panel
  before any job could run.

  1. Automatic After Effects startup/recovery: when AE is genuinely not
     running, the Worker now starts it from the AE_PATH this machine's own
     setup already validated. Bounded by construction - never when AE is
     already running, never on an inconclusive check, at most one attempt
     per cooldown window and a capped total, after which it reports an
     explicit actionable reason instead of retrying forever. (The Worker
     itself already started automatically at Windows logon; that part was
     already correct and is unchanged.)
  2. A real MCP health probe. The previous probe judged the bridge by a
     command-line exit code under a hard 8-second ceiling, so a genuinely
     healthy, connected bridge was reported as "unknown" whenever that
     command ran long - which blocked every job, permanently. The probe now
     performs the same real round trip a job does, with a realistic bounded
     budget and bounded retries, and only ever reports ONLINE on a real
     confirmed response.
  3. The same 8-second ceiling is raised for the Check Health operation,
     which had the identical problem.

  ROLLBACK: this update backs up the current program files before
  replacing them, verifies the Worker actually came back up afterwards,
  and automatically restores the backup if it did not.

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

function Test-ProcessAlive {
  param([int]$TargetProcessId)
  return $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId" -ErrorAction SilentlyContinue)
}

# A PID that has ALREADY exited is a success, not a failure. The previous
# version reported "Could not terminate worker child PID ..." simply because
# the supervisor's own tree-kill had already taken that child down moments
# earlier - a misleading error on a completely successful stop.
function Stop-OneProcessTree {
  param([int]$TargetProcessId, [string]$Label)
  if (-not (Test-ProcessAlive -TargetProcessId $TargetProcessId)) {
    Write-Host "[OK] $Label (PID $TargetProcessId) had already exited"
    return $true
  }
  & taskkill /F /T /PID $TargetProcessId *>$null
  Start-Sleep -Milliseconds 500
  if (Test-ProcessAlive -TargetProcessId $TargetProcessId) {
    Write-Host "[NEEDS ATTENTION] $Label (PID $TargetProcessId) is still running after being asked to stop"
    return $false
  }
  Write-Host "[OK] Stopped $Label (PID $TargetProcessId)"
  return $true
}

# REAL BUG THIS FIXES (2026-09-12, second failed install): these previously
# used `return @(...)`. PowerShell UNROLLS an array on return, and an EMPTY
# array unrolls to NO OUTPUT AT ALL - so the caller received $null, not an
# empty array. $null.Count is itself $null, so every count comparison below
# silently failed and Wait-ForHealthyWorkerTree could never return $true even
# for a perfectly healthy worker. That forced a rollback regardless of
# whether the update worked, and the rollback's own verification then failed
# the same way. The diagnostic message gave it away by printing
# "supervisor processes: " with an empty value rather than "0".
# The leading comma returns the array itself rather than its unrolled
# contents; every call site additionally wraps in @( ) so a single match can
# never arrive as a bare object either.
function Get-DyoSupervisorProcesses {
  $found = @(Get-DyoWorkerProcesses | Where-Object { $_.CommandLine -match [regex]::Escape("dist\supervisor\index.js") })
  return ,$found
}

function Get-DyoWorkerChildProcesses {
  $found = @(Get-DyoWorkerProcesses | Where-Object { $_.CommandLine -match [regex]::Escape("--env-file=.env dist\index.js") })
  return ,$found
}

# ORDER MATTERS: supervisors are stopped FIRST. A supervisor whose child is
# killed first immediately spawns a replacement (restarting the child is its
# entire job), and that replacement would not appear in an already-captured
# process list - which is exactly how an update can end up believing it
# cleaned up while a live worker still holds the files it is about to
# replace.
function Stop-DyoWorkerProcessesForcibly {
  foreach ($proc in @(Get-DyoSupervisorProcesses)) {
    [void](Stop-OneProcessTree -TargetProcessId $proc.ProcessId -Label "DYO Worker supervisor")
  }
  foreach ($proc in @(Get-DyoWorkerChildProcesses)) {
    [void](Stop-OneProcessTree -TargetProcessId $proc.ProcessId -Label "DYO Worker process")
  }
}

# Program files are NEVER replaced until every old process has genuinely
# exited - replacing them underneath a running worker is what left the
# machine with supervisor=1/worker=0 last time.
function Wait-ForNoDyoWorkerProcesses {
  param([int]$TimeoutSeconds = 30)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ((@(Get-DyoWorkerProcesses)).Count -eq 0) { return $true }
    Start-Sleep -Seconds 1
  }
  return ((@(Get-DyoWorkerProcesses)).Count -eq 0)
}

# Polls rather than sleeping a fixed few seconds: the supervisor starts
# first and only then spawns its worker child, so a fixed 5s sleep could
# observe supervisor=1/worker=0 on a perfectly healthy start and trigger a
# completely unnecessary rollback (exactly what happened on the first
# attempt).
function Wait-ForHealthyWorkerTree {
  param([int]$TimeoutSeconds = 120)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $supervisors = @(Get-DyoSupervisorProcesses)
    $children = @(Get-DyoWorkerChildProcesses)
    if ($supervisors.Count -gt 1) { return $false }
    if ($supervisors.Count -eq 1 -and $children.Count -ge 1) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

Write-Host "================================================"
Write-Host "  DYO Windows Worker - Startup & Recovery Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer so that After Effects and the ae-mcp bridge come back"
Write-Host "automatically after a restart, with no manual CONNECT step. It does"
Write-Host "not ask for a registration"
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

# ---- Step 2: stop the Worker COMPLETELY before touching any program file ----
Write-Host ""
Write-Host "Stopping DYO Worker before updating its files..."

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existingTask) {
  Write-Host "[NEEDS ATTENTION] The `"$TaskName`" automatic-startup task was not found."
  Write-Host "Please run DYO-Worker-Repair.bat (the full repair) instead, or contact DYO."
  Write-Host "Nothing has been changed on this computer."
  exit 1
}

if ($existingTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
Stop-DyoWorkerProcessesForcibly

if (-not (Wait-ForNoDyoWorkerProcesses -TimeoutSeconds 30)) {
  # One more bounded attempt - a child that respawned in the gap between
  # the supervisor stopping and this check gets one further chance to go.
  Stop-DyoWorkerProcessesForcibly
  if (-not (Wait-ForNoDyoWorkerProcesses -TimeoutSeconds 30)) {
    Write-Host "[NEEDS ATTENTION] DYO Worker processes are still running and could not be stopped:"
    foreach ($proc in Get-DyoWorkerProcesses) { Write-Host "  PID $($proc.ProcessId): $($proc.CommandLine)" }
    Write-Host ""
    Write-Host "NOTHING HAS BEEN CHANGED on this computer - the program files were deliberately"
    Write-Host "left untouched rather than replaced underneath a running worker. Please contact DYO."
    exit 1
  }
}
Write-CheckResult $true "DYO Worker fully stopped - no worker processes remain"

# ---- Step 3: update program files, including @modelcontextprotocol/sdk if not already present ----
Write-Host ""
Write-Host "Updating DYO Worker program files..."

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker Startup Recovery update package and try again."
  exit 1
}
# ---- Rollback point: back up the current program files BEFORE replacing them ----
$backupDir = Join-Path $InstallDir ("dist.backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$currentDist = Join-Path $InstallDir "dist"
if (Test-Path $currentDist) {
  Copy-Item -Path $currentDist -Destination $backupDir -Recurse -Force
  Write-CheckResult $true "Backed up current program files (rollback point created)"
} else {
  $backupDir = $null
  Write-Host "[OK] No existing dist folder to back up - this install will simply be created fresh"
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
  Write-Host "Check your internet connection and re-run DYO-Worker-StartupRecovery-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-StartupRecovery-Update.bat again. If this keeps happening, contact DYO."
  exit 1
}

# ---- Step 4: start DYO Worker and verify a real, healthy tree came back ----
Write-Host ""
Write-Host "Starting DYO Worker..."

function Restore-BackupAndRestart {
  param([string]$BackupDir)
  if (-not $BackupDir -or -not (Test-Path $BackupDir)) {
    Write-Host "[NEEDS ATTENTION] No rollback point is available - program files were left as updated."
    return
  }
  Write-Host "Rolling back to the previous program files..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Stop-DyoWorkerProcessesForcibly
  [void](Wait-ForNoDyoWorkerProcesses -TimeoutSeconds 30)
  $distPath = Join-Path $InstallDir "dist"
  if (Test-Path $distPath) { Remove-Item -Path $distPath -Recurse -Force }
  Copy-Item -Path $BackupDir -Destination $distPath -Recurse -Force
  Start-ScheduledTask -TaskName $TaskName
  if (Wait-ForHealthyWorkerTree -TimeoutSeconds 120) {
    Write-Host "[OK] Rolled back to the previous program files - DYO Worker is running again."
  } else {
    Write-Host "[NEEDS ATTENTION] Rolled back the program files, but DYO Worker did not come back up."
    Write-Host "Please contact DYO before using this computer."
  }
}

Start-ScheduledTask -TaskName $TaskName

if (-not (Wait-ForHealthyWorkerTree -TimeoutSeconds 120)) {
  $supervisors = @(Get-DyoSupervisorProcesses)
  $children = @(Get-DyoWorkerChildProcesses)
  Write-Host "[NEEDS ATTENTION] DYO Worker did not come back up correctly after the update"
  Write-Host "(supervisor processes: $($supervisors.Count), worker processes: $($children.Count) - expected exactly 1 and at least 1)."
  Restore-BackupAndRestart -BackupDir $backupDir
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
