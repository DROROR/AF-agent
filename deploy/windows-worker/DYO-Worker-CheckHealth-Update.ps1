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
  the update took effect comes from this script's own verification below
  (a genuinely new worker process, a real new successful heartbeat, and
  CHECK_HEALTH/INSPECT_TEMPLATE both present in that new process's own
  startup log line) - never printed blindly.

  Fixes a real restart race present in earlier update scripts: Task
  Scheduler only tracks the top-level process it launched (run-worker.bat's
  cmd.exe host), not the node.exe child it spawns - stopping the task can
  return before that child has actually exited. Because the task is
  registered with -MultipleInstances IgnoreNew (see DYO-Worker-Setup.ps1),
  starting it again while that old child still lingers is silently
  ignored, leaving the OLD build running while a script that didn't check
  for this would wrongly report success. This script verifies zero
  matching node.exe processes remain (escalating to a scoped, targeted
  Stop-Process if needed) before ever restarting, and verifies a new
  process + a real new heartbeat exist afterward before ever printing
  success.

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
    - only ever targets node.exe processes whose own command line
      references THIS install directory - never any other process on the
      machine.
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

function Write-CheckResult {
  param([bool]$Ok, [string]$Label, [string]$Detail = "")
  $mark = if ($Ok) { "[OK]" } else { "[NEEDS ATTENTION]" }
  if ($Detail) {
    Write-Host "$mark $Label - $Detail"
  } else {
    Write-Host "$mark $Label"
  }
}

# Task Scheduler itself only tracks the top-level process it launched, not
# node.exe's child process spawned inside run-worker.bat - real ground
# truth is "does a matching node.exe process actually exist right now",
# not "what State does the task report". Matched narrowly by command line
# referencing this exact install directory, so this can never touch an
# unrelated node.exe process on the machine.
function Get-DyoWorkerProcesses {
  param([string]$Dir)
  $needle = $Dir.ToLowerInvariant()
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) }
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
# still-running old process. See the .DESCRIPTION above for exactly why a
# bare Stop-ScheduledTask + fixed sleep is not sufficient here.
Write-Host ""
Write-Host "Stopping DYO Worker safely..."

if ($task.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

$stopped = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $procs = Get-DyoWorkerProcesses -Dir $InstallDir
  ($null -eq $t -or $t.State -ne "Running") -and $procs.Count -eq 0
}

if (-not $stopped) {
  Write-Host "DYO Worker did not stop within 20 seconds - terminating the lingering process directly..."
  Get-DyoWorkerProcesses -Dir $InstallDir | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
  }
  $stopped = Wait-Until -TimeoutSeconds 10 -PollSeconds 1 -Condition {
    (Get-DyoWorkerProcesses -Dir $InstallDir).Count -eq 0
  }
}

if (-not $stopped) {
  Write-Host "[NEEDS ATTENTION] Could not confirm DYO Worker fully stopped."
  Write-Host "No program files were changed - it is not safe to update while the old process"
  Write-Host "may still be running. Please close any DYO Worker window/terminal manually,"
  Write-Host "restart this computer if needed, then try again. Contact DYO if this persists."
  exit 1
}
Write-CheckResult $true "DYO Worker fully stopped (verified no worker process is still running)"

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

# ---- Step 4: restart DYO Worker, and PROVE the update actually took effect ----
Write-Host ""
Write-Host "Restarting DYO Worker with the updated program files..."

$logPath = Join-Path $InstallDir "logs\worker.log"
$logLengthBeforeRestart = 0
if (Test-Path $logPath) { $logLengthBeforeRestart = (Get-Item $logPath).Length }

function Get-NewLogContent {
  if (-not (Test-Path $logPath)) { return "" }
  $stream = [System.IO.File]::Open($logPath, 'Open', 'Read', [System.IO.FileShare]::ReadWrite)
  try {
    $stream.Seek($logLengthBeforeRestart, [System.IO.SeekOrigin]::Begin) | Out-Null
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } finally {
    $stream.Close()
  }
}

Start-ScheduledTask -TaskName $TaskName
$started = Wait-Until -TimeoutSeconds 8 -PollSeconds 1 -Condition {
  (Get-DyoWorkerProcesses -Dir $InstallDir).Count -gt 0
}
if (-not $started) {
  # A stale IgnoreNew flag on Task Scheduler's own side (distinct from the
  # process-level race already closed above) is rare but possible - one
  # extra explicit start attempt before treating this as a real failure.
  Start-ScheduledTask -TaskName $TaskName
  $started = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
    (Get-DyoWorkerProcesses -Dir $InstallDir).Count -gt 0
  }
}
if (-not $started) {
  Write-Host "[NEEDS ATTENTION] DYO Worker did not start a new process after restart."
  Write-Host "Program files were updated, but the worker is not confirmed running."
  Write-Host "Please run DYO-Worker-Repair.bat, or contact DYO."
  exit 1
}
Write-CheckResult $true "A new DYO Worker process is running"

Write-Host "Waiting for a real successful heartbeat from the new process (up to 30 seconds)..."
$heartbeatOk = Wait-Until -TimeoutSeconds 30 -PollSeconds 2 -Condition {
  (Get-NewLogContent) -match '"msg":"heartbeat succeeded"'
}
$newContent = Get-NewLogContent

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
if ($commitMatch.Success) {
  Write-CheckResult $true "Running build" ("commit " + $commitMatch.Groups[1].Value)
} else {
  Write-Host "[OK] No build/version marker found in this log line - functionality above is still verified independently."
}

Write-Host ""
Write-Host "================================================"
Write-Host "  Update complete"
Write-Host "================================================"
Write-Host "DYO Worker is running the updated program files, with a genuinely new process"
Write-Host "and a real confirmed heartbeat - using the same DYO Worker identity this"
Write-Host "computer already had. No new registration was created. No After Effects"
Write-Host "project was opened, changed, or run against by this update."
Write-Host ""
Write-Host "Latest status:"
Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
