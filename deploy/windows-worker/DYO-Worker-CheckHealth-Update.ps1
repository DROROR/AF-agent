<#
.SYNOPSIS
  DYO Windows Worker - CHECK_HEALTH remote diagnostics update, for an
  ALREADY-REGISTERED install. Double-click DYO-Worker-CheckHealth-Update.bat
  instead of running this file directly.

.DESCRIPTION
  Ships the real, already-committed CHECK_HEALTH diagnostic job (plus the
  current INSPECT_TEMPLATE/HeroicSwan integration) to an already-registered
  machine, without asking for a new registration code and without running
  any diagnostic or inspection itself:
    - CHECK_HEALTH becomes a real, dispatchable job operation. It only ever
      runs two fixed, already-approved diagnostics - an AE process check,
      and the documented `node <AE_MCP_PATH>\dist\index.js health` command -
      never an arbitrary command, never shell/PowerShell/JSX input. It is
      deliberately NOT gated on AE/MCP already being confirmed Online:
      diagnosing a disagreement in that exact status is its whole purpose.
    - The current INSPECT_TEMPLATE implementation (HeroicSwanTemplateInspector)
      and its ae-mcp MCP integration ship alongside it, unchanged from
      whatever is already committed to main.

  This script itself never runs CHECK_HEALTH or INSPECT_TEMPLATE, never
  connects to ae-mcp, and never opens or touches any After Effects project -
  it only replaces program files and restarts the worker. Real proof that
  the update took effect comes entirely from this script's own verification
  below - never printed blindly:
    - the exact OLD worker process(es) are confirmed gone (by PID, not by
      an install-directory guess - see the CONFIRMED BUG note below),
    - a NEW worker process exists afterward, with a PID that was never one
      of the old ones,
    - a real new successful heartbeat appears in log content this script
      itself guarantees is fresh (see LOG ROTATION note below),
    - that same fresh content shows CHECK_HEALTH and INSPECT_TEMPLATE, and
      a real BUILD_INFO commit marker.

  CONFIRMED BUG in an earlier version of this script (two real update
  attempts on the client's machine both failed at the same point because
  of it): it matched candidate worker processes by searching each node.exe
  process's own CommandLine for the install directory path
  (e.g. "C:\DYO-Agent\app"). But run-worker.bat launches the worker with
  purely RELATIVE arguments after `cd /d "%~dp0"`:
      node --env-file=.env dist\index.js
  so the install directory is never actually present in the real
  CommandLine at all - that match could never succeed, for the old process
  OR a new one. This made "verify stopped" false-positive instantly (an
  empty result set trivially satisfies "count is zero"), likely leaving
  the real old process running (Task Scheduler's own -MultipleInstances
  IgnoreNew then silently ignores the next Start-ScheduledTask - see
  DYO-Worker-Setup.ps1), and made "verify started" fail 100% of the time
  regardless of whether the restart actually worked. Fixed below by
  matching on the worker's own fixed invocation signature instead
  (dist\index.js + --env-file=.env both present), which is true regardless
  of install path, and never matches an unrelated Node application.

  LOG ROTATION: run-worker.bat itself renames any existing worker.log to
  worker.log.previous before each start, but this script does not rely on
  that alone - it proactively moves any existing worker.log out of the way
  itself, right before restarting, so "read worker.log after restart" can
  never be contaminated by stale content from the old process, without
  needing to track or trust a byte offset into what might now be a
  logically different file.

  Safety, same as DYO-Worker-Setup.ps1/DYO-Worker-Repair.ps1:
    - never asks for or stores a Windows account password.
    - never asks for a registration code - if no worker-credentials.json
      is found, this STOPS with a clear message instead of silently
      registering a new, duplicate worker identity.
    - WORKER_ID/WORKER_TOKEN are never read, written, or passed as
      arguments here - this script never even opens worker-credentials.json,
      it only checks that the file exists.
    - never runs CHECK_HEALTH, INSPECT_TEMPLATE, or any AE-mutating tool -
      this update only installs the capability; nothing in this script
      calls it.
    - only ever targets node.exe processes whose own command line matches
      the worker's exact fixed invocation signature - never a generic
      node.exe, never an unrelated Node application, never "all node.exe
      processes".
    - installed files remain restricted (via NTFS ACLs, already applied by
      DYO-Worker-Setup.bat) to the current Windows user and SYSTEM.

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

# The worker's own fixed, real invocation signature (run-worker.bat:
# `node --env-file=.env dist\index.js`) - deliberately NOT the install
# directory (see CONFIRMED BUG above: that substring is never present in
# the real command line, since run-worker.bat `cd /d`s first and passes
# only relative arguments). Both substrings must be present; neither alone
# is a safe enough signature to justify stopping/killing a process over.
$WorkerEntrypointPattern = 'dist\\index\.js'
$WorkerEnvArgPattern = '--env-file=\.env'

function Write-CheckResult {
  param([bool]$Ok, [string]$Label, [string]$Detail = "")
  $mark = if ($Ok) { "[OK]" } else { "[NEEDS ATTENTION]" }
  if ($Detail) {
    Write-Host "$mark $Label - $Detail"
  } else {
    Write-Host "$mark $Label"
  }
}

# Exported as a real function (not inlined into the CIM pipeline) so it can
# be reasoned about/tested in isolation against realistic sample command
# lines - see scripts/windows-worker/__tests__/dyo-worker-checkhealth-update.test.ts.
function Test-IsDyoWorkerCommandLine {
  param([string]$CommandLine)
  if ([string]::IsNullOrEmpty($CommandLine)) { return $false }
  return ($CommandLine -match $WorkerEntrypointPattern) -and ($CommandLine -match $WorkerEnvArgPattern)
}

# Real ground truth is "does a matching worker node.exe process actually
# exist right now" - Task Scheduler only tracks the top-level process it
# launched (run-worker.bat's cmd.exe host), not the node.exe child spawned
# inside it, so the task's own reported State is never trusted alone.
function Get-DyoWorkerProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { Test-IsDyoWorkerCommandLine -CommandLine $_.CommandLine }
}

function Wait-Until {
  param([scriptblock]$Condition, [int]$TimeoutSeconds, [int]$PollSeconds = 1)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return $true }
    Start-Sleep -Seconds $PollSeconds
  }
  return [bool](& $Condition)
}

Write-Host "================================================"
Write-Host "  DYO Windows Worker - CHECK_HEALTH Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer to add the CHECK_HEALTH remote diagnostic job. It does not ask"
Write-Host "for a registration code, does not change which DYO Worker this computer"
Write-Host "is, and does not open, modify, or run anything against any After Effects"
Write-Host "project."
Write-Host ""

# ---- Step 1: confirm this is actually an already-registered install ----
#
# Never silently falls through to registering a new worker identity if
# credentials are missing - that would create a duplicate worker server-
# side. An operator/client who needs first-time setup must run
# DYO-Worker-Setup.bat instead, which is the only script that ever asks
# for a registration code.
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
  Write-Host "has never been registered, please run DYO-Worker-Setup.bat instead."
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

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "[NEEDS ATTENTION] The `"$TaskName`" automatic-startup task was not found."
  Write-Host "Please run DYO-Worker-Repair.bat (the full repair) instead, or contact DYO."
  exit 1
}
Write-CheckResult $true "Existing automatic-startup task found - it will be kept, not re-registered"

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker CHECK_HEALTH update package and try again."
  exit 1
}

# ---- Step 2: stop DYO Worker safely, and PROVE it actually stopped ----
#
# Files are replaced only once this is confirmed - never overlapping a
# still-running old process. The old PIDs are recorded here so the later
# "a genuinely NEW process" check has something real to compare against,
# not just "a process exists" (which the confirmed bug already showed is
# not sufficient on its own).
Write-Host ""
Write-Host "Stopping DYO Worker safely..."

$oldPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)

if ($task.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

$stopped = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $procs = Get-DyoWorkerProcesses
  ($null -eq $t -or $t.State -ne "Running") -and $procs.Count -eq 0
}

if (-not $stopped) {
  Write-Host "DYO Worker did not stop within 20 seconds - terminating the lingering process directly..."
  Get-DyoWorkerProcesses | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
  }
  $stopped = Wait-Until -TimeoutSeconds 10 -PollSeconds 1 -Condition {
    (Get-DyoWorkerProcesses).Count -eq 0
  }
}

if (-not $stopped) {
  Write-Host "[NEEDS ATTENTION] Could not confirm DYO Worker fully stopped."
  Write-Host "No program files were changed - it is not safe to update while the old process"
  Write-Host "may still be running. Please close any DYO Worker window/terminal manually,"
  Write-Host "restart this computer if needed, then try again. Contact DYO if this persists."
  exit 1
}
Write-CheckResult $true "DYO Worker fully stopped (verified no matching worker process is still running)"

# ---- Step 3: replace only the program files - .env is never touched ----
Write-Host ""
Write-Host "Updating DYO Worker program files..."
Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force -Exclude ".env"
Write-CheckResult $true "Updated DYO Worker program files"

Write-Host "Checking runtime dependencies (only needs internet access if something is missing)..."
Push-Location $InstallDir
& npm install --omit=dev --no-audit --no-fund *>$null
$npmExitCode = $LASTEXITCODE
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Installing dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-CheckHealth-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

# ---- Step 4: guarantee a clean log slate before restarting ----
#
# run-worker.bat itself renames an existing worker.log to worker.log.previous
# before each start, but this script does not rely on that alone - moving
# it aside here too means "read worker.log after restart" can never pick
# up stale content, without needing to track or trust a byte offset into
# what might otherwise be a logically different file after rotation.
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  $preUpdateBackup = Join-Path $InstallDir ("logs\worker.log.pre-update-" + (Get-Date -Format "yyyyMMddHHmmss"))
  Move-Item -Path $logPath -Destination $preUpdateBackup -Force
}

function Get-FreshLogContent {
  if (-not (Test-Path $logPath)) { return "" }
  # Read-only, shared access - never interferes with the worker process
  # that is actively appending to this same file.
  $stream = [System.IO.File]::Open($logPath, 'Open', 'Read', [System.IO.FileShare]::ReadWrite)
  try {
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } finally {
    $stream.Close()
  }
}

# ---- Step 5: restart DYO Worker, and PROVE the update actually took effect ----
Write-Host ""
Write-Host "Restarting DYO Worker with the updated program files..."

Start-ScheduledTask -TaskName $TaskName
$started = Wait-Until -TimeoutSeconds 8 -PollSeconds 1 -Condition {
  $newPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
  ($newPids | Where-Object { $oldPids -notcontains $_ }).Count -gt 0
}
if (-not $started) {
  # A stale IgnoreNew flag on Task Scheduler's own side (distinct from the
  # process-level race already closed above) is rare but possible - one
  # extra explicit start attempt before treating this as a real failure.
  Start-ScheduledTask -TaskName $TaskName
  $started = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
    $newPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
    ($newPids | Where-Object { $oldPids -notcontains $_ }).Count -gt 0
  }
}
if (-not $started) {
  Write-Host "[NEEDS ATTENTION] DYO Worker did not start a genuinely new process after restart."
  Write-Host "Program files were updated, but the worker is not confirmed running on a new"
  Write-Host "process. Please run DYO-Worker-Repair.bat, or contact DYO."
  exit 1
}
Write-CheckResult $true "A genuinely new DYO Worker process is running (PID differs from before)"

Write-Host "Waiting for a real successful heartbeat from the new process (up to 30 seconds)..."
$heartbeatOk = Wait-Until -TimeoutSeconds 30 -PollSeconds 2 -Condition {
  (Get-FreshLogContent) -match '"msg":"heartbeat succeeded"'
}
$newContent = Get-FreshLogContent

if (-not $heartbeatOk) {
  Write-Host "[NEEDS ATTENTION] The new DYO Worker process is running, but no successful"
  Write-Host "heartbeat was observed within 30 seconds. Check your internet connection,"
  Write-Host "then check logs\worker.log directly before assuming this update failed."
  exit 1
}
Write-CheckResult $true "New process sent a real successful heartbeat"

if ($newContent -match '"msg":"worker starting"' -and $newContent -match "CHECK_HEALTH" -and $newContent -match "INSPECT_TEMPLATE") {
  Write-CheckResult $true "Worker capabilities include CHECK_HEALTH and INSPECT_TEMPLATE"
} else {
  Write-Host "[NEEDS ATTENTION] Could not confirm CHECK_HEALTH/INSPECT_TEMPLATE in the new"
  Write-Host "process's own startup log line. The process is running and heartbeating, but"
  Write-Host "this specific update may not have taken effect correctly. Contact DYO."
  exit 1
}

$commitMatch = [regex]::Match($newContent, '"commit":"([0-9a-f]{7,40})"')
if (-not $commitMatch.Success) {
  Write-Host "[NEEDS ATTENTION] No build/version marker (BUILD_INFO commit) was found in the"
  Write-Host "new process's own startup log line. Everything else checks out, but this update"
  Write-Host "package cannot prove which build is now running. Contact DYO."
  exit 1
}
Write-CheckResult $true "Running build" ("commit " + $commitMatch.Groups[1].Value)

Write-Host ""
Write-Host "================================================"
Write-Host "  Update complete"
Write-Host "================================================"
Write-Host "DYO Worker is running the updated program files, with a genuinely new process"
Write-Host "(confirmed by PID), a real confirmed heartbeat, and a confirmed build marker -"
Write-Host "using the same DYO Worker identity this computer already had. No new"
Write-Host "registration was created. No After Effects project was opened, changed, or run"
Write-Host "against by this update."
Write-Host ""
Write-Host "Latest status:"
Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
