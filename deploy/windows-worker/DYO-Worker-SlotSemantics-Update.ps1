<#
.SYNOPSIS
  DYO Windows Worker - safe inspections, slot semantics and measured asset
  facts, for an ALREADY-REGISTERED install. Double-click
  DYO-Worker-SlotSemantics-Update.bat instead of running this file directly.

.DESCRIPTION
  Ships the worker side of build 8f3568a.

  1. INSPECTIONS NEVER OPEN THE REAL PROJECT ANY MORE.
     Every inspection that opens an After Effects project now works on a
     uniquely-named DISPOSABLE COPY, created beside the file it inspects so
     relative footage still resolves, and removed afterwards. The immutable
     source .aep and the session working copy are never opened. The worker
     refuses to disturb an After Effects project that has unsaved changes,
     is untitled, or cannot be read reliably - it never answers a Save
     Changes prompt for you - and it hashes the protected files before and
     after every inspection, failing closed if either changed.

  2. EVERY IMAGE SLOT IS CLASSIFIED FROM STRUCTURE.
     Each slot a client asset can land in is judged as a device screen or a
     flat card from nesting, what its track matte is MADE OF, 3D state,
     animated parents and geometry - never from a layer name. An uncertain
     or self-contradicting verdict blocks the plan until a human decides,
     with the evidence shown.

  3. THE STRUCTURE IS RE-PROVED IMMEDIATELY BEFORE ANY EDIT.
     Before replacing footage, the worker re-reads the live chain and
     compares a fingerprint taken when the plan was approved. A layer
     inserted, a host reparented, a matte changed or a slot resized fails
     the operation closed rather than editing something that is no longer
     what was approved.

  4. RIGHT-TO-LEFT TEXT IS SET CORRECTLY, AND VERIFIED.
     Hebrew and other RTL text is applied with the paragraph direction and
     composer engine After Effects needs, then read back and checked code
     unit by code unit.

  WHAT THIS UPDATE DOES NOT DO: it never opens, inspects, modifies or
  renders any After Effects project as part of installing. It only replaces
  program files and restarts the worker.

  ROLLBACK: this update backs up the current program files before replacing
  them, verifies the Worker actually came back up afterwards, and
  automatically restores the backup if it did not.

  Never touches .env: DYO_API_URL, AE_PATH, AE_MCP_PATH, AERENDER_PATH and
  WORK_ROOT are left exactly as they already are, and the worker's identity
  (WORKER_ID/WORKER_TOKEN) is never read, written or re-registered.
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

# PID 0 (System Idle) and PID 4 (System) are never ours, under any
# circumstances. An explicit floor, independent of every other check below.
$SystemProcessIdFloor = 4

function Get-LiveProcessById {
  param([int]$TargetProcessId)
  return Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId" -ErrorAction SilentlyContinue
}

# Identity, not mere existence. Used to re-confirm a process STILL belongs to
# DYO Worker at the moment it is about to be stopped.
function Test-IsDyoWorkerProcess {
  param($CandidateProcess)
  if ($null -eq $CandidateProcess) { return $false }
  if ($CandidateProcess.ProcessId -le $SystemProcessIdFloor) { return $false }
  if ($CandidateProcess.Name -ne "node.exe") { return $false }
  $cmd = $CandidateProcess.CommandLine
  if (-not $cmd) { return $false }
  foreach ($pattern in $WorkerProcessCommandLinePatterns) {
    if ($cmd -match $pattern) { return $true }
  }
  return $false
}

# REAL INCIDENT THIS FIXES (2026-09-12): this previously checked only that
# SOME process still held the captured PID, then killed it. Windows reuses
# process IDs - between capturing the list and stopping it, a worker PID had
# exited and been recycled, so the script attempted to terminate PID 188, a
# child of PID 4 (System). Existence is not identity. A process is now
# re-verified at the moment of the kill: same PID, same creation time, still
# node.exe, still matching this worker's own command lines. Anything else is
# left strictly alone.
function Stop-OneProcessTree {
  param($TargetProcess, [string]$Label)
  $targetId = $TargetProcess.ProcessId
  if ($targetId -le $SystemProcessIdFloor) {
    Write-Host "[OK] Refusing to touch PID $targetId - system process IDs are never DYO Worker"
    return $true
  }
  $live = Get-LiveProcessById -TargetProcessId $targetId
  if ($null -eq $live) {
    Write-Host "[OK] $Label (PID $targetId) had already exited"
    return $true
  }
  if ($live.CreationDate -ne $TargetProcess.CreationDate -or -not (Test-IsDyoWorkerProcess -CandidateProcess $live)) {
    Write-Host "[OK] PID $targetId is no longer the DYO Worker process it was (Windows reuses process IDs) - leaving it alone"
    return $true
  }

  # taskkill writes to stderr in ordinary situations (for example when the
  # tree it is walking has already partly exited). Under
  # $ErrorActionPreference = "Stop" PowerShell turns native stderr into a
  # TERMINATING NativeCommandError, which aborted this installer outright -
  # so this one call is deliberately run with errors non-terminating.
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & taskkill /F /T /PID $targetId 2>&1 | Out-Null
  } catch {
    # Reported via the liveness re-check below, never by taskkill's own output.
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  Start-Sleep -Milliseconds 500
  $stillLive = Get-LiveProcessById -TargetProcessId $targetId
  if ($null -ne $stillLive -and (Test-IsDyoWorkerProcess -CandidateProcess $stillLive) -and $stillLive.CreationDate -eq $TargetProcess.CreationDate) {
    Write-Host "[NEEDS ATTENTION] $Label (PID $targetId) is still running after being asked to stop"
    return $false
  }
  Write-Host "[OK] Stopped $Label (PID $targetId)"
  return $true
}

# REAL 2026-09-15 BUG: these used to end with `return ,$found`, and every
# caller wraps them again in @(...). That nests the result, so .Count was
# always 1 - even with ZERO matching processes (reproduced exactly: blank
# properties, then "Cannot convert null to type System.DateTimeOffset").
# Plain pipeline output lets each caller's @(...) produce the real count.
function Get-DyoSupervisorProcesses {
  Get-DyoWorkerProcesses | Where-Object { $_.CommandLine -match [regex]::Escape("dist\supervisor\index.js") }
}

function Get-DyoWorkerChildProcesses {
  Get-DyoWorkerProcesses | Where-Object { $_.CommandLine -match [regex]::Escape("--env-file=.env dist\index.js") }
}

# ORDER MATTERS: supervisors are stopped FIRST. A supervisor whose child is
# killed first immediately spawns a replacement (restarting the child is its
# entire job), and that replacement would not appear in an already-captured
# process list - which is exactly how an update can end up believing it
# cleaned up while a live worker still holds the files it is about to
# replace.
function Stop-DyoWorkerProcessesForcibly {
  foreach ($proc in @(Get-DyoSupervisorProcesses)) {
    [void](Stop-OneProcessTree -TargetProcess $proc -Label "DYO Worker supervisor")
  }
  foreach ($proc in @(Get-DyoWorkerChildProcesses)) {
    [void](Stop-OneProcessTree -TargetProcess $proc -Label "DYO Worker process")
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
    if ($supervisors.Count -gt 1 -or $children.Count -gt 1) { return $false }
    if ($supervisors.Count -eq 1 -and $children.Count -eq 1) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

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
  # Restored together with the code it describes - see the backup step.
  if (Test-Path $buildInfoBackup) {
    Copy-Item -Path $buildInfoBackup -Destination (Join-Path $InstallDir "BUILD_INFO.json") -Force
  }
  Start-ScheduledTask -TaskName $TaskName
  if (Wait-ForHealthyWorkerTree -TimeoutSeconds 120) {
    Write-Host "[OK] Rolled back to the previous program files - DYO Worker is running again."
  } else {
    Write-Host "[NEEDS ATTENTION] Rolled back the program files, but DYO Worker did not come back up."
    Write-Host "Please contact DYO before using this computer."
  }
}


# Every abort path that happens AFTER the Scheduled Task has been stopped
# must leave this computer with a RUNNING worker - the existing, unmodified
# one. An installer that gives up is never a reason for the machine to sit
# there doing nothing.
function Restart-ExistingWorkerAfterAbort {
  Write-Host "Restarting the existing DYO Worker (unchanged) before exiting..."
  try {
    Start-ScheduledTask -TaskName $TaskName
  } catch {
    Write-Host "[NEEDS ATTENTION] Could not restart the existing DYO Worker automatically."
    return
  }
  if (Wait-ForHealthyWorkerTree -TimeoutSeconds 120) {
    Write-CheckResult $true "The existing DYO Worker is running again - this computer is back to how it started"
  } else {
    Write-Host "[NEEDS ATTENTION] The existing DYO Worker did not come back up - please contact DYO."
  }
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
    foreach ($proc in @(Get-DyoWorkerProcesses)) { Write-Host "  PID $($proc.ProcessId): $($proc.CommandLine)" }
    Write-Host ""
    Write-Host "NOTHING HAS BEEN CHANGED on this computer - the program files were deliberately"
    Write-Host "left untouched rather than replaced underneath a running worker."
    Restart-ExistingWorkerAfterAbort
    Write-Host "Please contact DYO."
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
# BUILD_INFO.json lives at the app root, OUTSIDE dist, and is what the worker
# logs as its running commit. Backing up dist alone would let a rollback
# leave the RESTORED code reporting the commit of the build that was rolled
# BACK - the two would silently disagree, and the log could no longer be
# trusted to identify which code is actually running. Both are backed up and
# restored together, always.
$buildInfoPath = Join-Path $InstallDir "BUILD_INFO.json"
$buildInfoBackup = "$backupDir.BUILD_INFO.json"
if (Test-Path $currentDist) {
  Copy-Item -Path $currentDist -Destination $backupDir -Recurse -Force
  if (Test-Path $buildInfoPath) { Copy-Item -Path $buildInfoPath -Destination $buildInfoBackup -Force }
  Write-CheckResult $true "Backed up current program files (rollback point created)"
} else {
  $backupDir = $null
  Write-Host "[OK] No existing dist folder to back up - this install will simply be created fresh"
}

Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force -Exclude ".env"
Write-CheckResult $true "Updated DYO Worker program files"

Write-Host "Checking runtime dependencies (only needs internet access if something is missing)..."
Push-Location $InstallDir
# REAL 2026-09-15 FAILURE: `& npm install ... *>$null` under
# $ErrorActionPreference = "Stop" aborted this installer after the worker had
# been stopped and the files copied - Windows PowerShell 5.1 turns a native
# program's stderr ("npm notice ...") into a terminating NativeCommandError
# even when it is redirected. npm now runs through cmd.exe with its output
# redirected INSIDE cmd, so PowerShell never sees a stderr stream; only npm's
# own exit code decides the outcome (the same approach as taskkill above).
$npmLogPath = Join-Path $InstallDir "logs\update-npm-install.log"
if (-not (Test-Path (Split-Path $npmLogPath))) { New-Item -ItemType Directory -Path (Split-Path $npmLogPath) | Out-Null }
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  & cmd.exe /d /c "npm install --omit=dev --no-audit --no-fund > `"$npmLogPath`" 2>&1"
  $npmExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Installing dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-SlotSemantics-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

# REAL INCIDENT GUARD (2026-09-12): a rollback restored older code into
# dist while leaving the newer BUILD_INFO.json in place, so the worker
# logged the new commit while actually running the old code - and a
# verification that trusted the log alone reported a successful install of
# software that was not there. The installer now proves the new code
# physically landed, by checking for files this release actually
# introduces, before it will restart anything or claim success.
# Files that exist ONLY in this release. Verifying these (not just
# dist\index.js, which every build has) is what catches the real
# 2026-09-12 failure mode where a stale payload installs "successfully"
# and the worker then logs a new commit while running old code.
$newBuildMarkers = @(
  (Join-Path $InstallDir "dist\inspection\disposable-project.js"),
  (Join-Path $InstallDir "dist\inspection\project-state-lock.js"),
  (Join-Path $InstallDir "dist\inspection\build-slot-facts.js"),
  (Join-Path $InstallDir "schemas\dist\slot-semantics.js"),
  (Join-Path $InstallDir "schemas\dist\slot-readiness.js"),
  (Join-Path $InstallDir "schemas\dist\text-direction.js"),
  (Join-Path $InstallDir "schemas\dist\text-digest.js"),
  (Join-Path $InstallDir "dist\index.js")
)
foreach ($marker in $newBuildMarkers) {
  if (-not (Test-Path $marker)) {
    Write-Host "[NEEDS ATTENTION] The updated program files did not land correctly - missing:"
    Write-Host "  $marker"
    Restore-BackupAndRestart -BackupDir $backupDir
    exit 1
  }
}
Write-CheckResult $true "Verified the updated program files are actually installed"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-SlotSemantics-Update.bat again. If this keeps happening, contact DYO."
  exit 1
}

# ---- Step 4: start DYO Worker and verify a real, healthy tree came back ----
Write-Host ""
Write-Host "Starting DYO Worker..."

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
Write-Host "DYO Worker is running build 8f3568a, using the same DYO"
Write-Host "Worker identity this computer already had - no new registration was created."
Write-Host "No After Effects project was opened, changed, or run against by this"
Write-Host "update itself."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
