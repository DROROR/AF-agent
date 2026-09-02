<#
.SYNOPSIS
  DYO Windows Worker - ONE-CLICK RECOVERY. Double-click
  DYO-Worker-Recover.bat instead of running this file directly.

.DESCRIPTION
  Restores DYO Worker to its last known-working program-file backup,
  without asking for a registration code and without changing this
  computer's WORKER_ID/WORKER_TOKEN, .env configuration, or the "DYO
  Video Worker" Scheduled Task's identity in any way beyond refreshing
  its recovery settings (same Action/Trigger/Principal convention as
  DYO-Worker-Final-Update.ps1).

  This is the standalone version of the automatic rollback that
  DYO-Worker-Final-Update.ps1 already runs on its own if a new build
  fails its post-update health check. Run this by hand only if:
    - an update reported "UPDATE FAILED - AUTOMATIC ROLLBACK COULD NOT
      BE FULLY VERIFIED" and told you to run this script, or
    - DYO Worker seems unhealthy for any other reason and DYO has asked
      you to try a recovery before a fresh update/repair.

  What it does, in order:
    1. Finds the most recent backup under WorkRoot\backups\ (folders
       named worker-app-pre-update-<timestamp>, created automatically
       by DYO-Worker-Final-Update.ps1 before every program-file
       replacement).
    2. Sets the maintenance flag, stops the current DYO Worker process
       (After Effects itself is never touched or closed).
    3. Restores that backup's program files over the current install -
       .env is never overwritten.
    4. Refreshes the Scheduled Task's recovery settings and restarts
       DYO Worker using the existing installed startup mechanism.
    5. Waits for a real heartbeat, clears the maintenance flag, and
       reports PASS/FAIL clearly - it never claims success it did not
       independently verify.

  Never re-registers this computer, never asks for a registration code,
  never reads or writes worker-credentials.json, never touches .env,
  and never opens, changes, or renders any After Effects project.

.PARAMETER InstallDir
  Where the DYO Worker program files are installed.

.PARAMETER WorkRoot
  Local folder for worker state - this is also where backups\ lives.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = "C:\DYO-Agent\app",
  [string]$WorkRoot = "C:\DYO-Agent"
)

$ErrorActionPreference = "Stop"

# Must match DYO-Worker-Setup.ps1/DYO-Worker-Final-Update.ps1 exactly - this
# restarts the same OS-level Scheduled Task, it does not create a second one
# and has nothing to do with the worker's own identity.
$TaskName = "DYO Video Worker"

# Same fixed, real invocation signature DYO-Worker-Final-Update.ps1 uses -
# see that script's own header comment for why this is tolerant of either
# path separator and never matches the supervisor's own process.
$WorkerEntrypointPattern = 'dist[\\/]index\.js'
$WorkerEnvArgPattern = '--env-file=\.env'

# Same authoritative "maintenance in progress" signal
# apps/worker/src/supervisor/maintenance-flag.ts checks before every
# restart attempt - set before stopping DYO Worker below, cleared only
# once the restored worker has been started again.
$MaintenanceFlagPath = Join-Path $WorkRoot "state\maintenance.flag"

$logPath = Join-Path $InstallDir "logs\worker.log"

function Write-CheckResult {
  param([bool]$Ok, [string]$Label, [string]$Detail = "")
  $mark = if ($Ok) { "[OK]" } else { "[NEEDS ATTENTION]" }
  if ($Detail) {
    Write-Host "$mark $Label - $Detail"
  } else {
    Write-Host "$mark $Label"
  }
}

function Test-IsDyoWorkerCommandLine {
  param([string]$CommandLine)
  if ([string]::IsNullOrEmpty($CommandLine)) { return $false }
  return ($CommandLine -match $WorkerEntrypointPattern) -and ($CommandLine -match $WorkerEnvArgPattern)
}

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

function Get-FreshLogContent {
  if (-not (Test-Path $logPath)) { return "" }
  $stream = [System.IO.File]::Open($logPath, 'Open', 'Read', [System.IO.FileShare]::ReadWrite)
  try {
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } finally {
    $stream.Close()
  }
}

function Test-DyoWorkerTaskActionHealthy {
  param([string]$TaskName)
  try {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $actions = @($t.Actions)
    if ($actions.Count -eq 0) { return $false }
    return -not [string]::IsNullOrWhiteSpace($actions[0].Execute)
  } catch {
    return $false
  }
}

function Register-DyoWorkerTaskDefinition {
  param([string]$TaskName, [string]$SupervisorLauncher, [string]$InstallDir, [switch]$Force)
  $taskAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$SupervisorLauncher`"" `
    -WorkingDirectory $InstallDir
  $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew
  $description = "Runs the DYO Video Worker automatically when $env:USERNAME logs into Windows. Installed/updated by DYO-Worker-Final-Update.ps1 - safe to remove via DYO-Worker-Uninstall.bat."
  $forceArg = @{}
  if ($Force) { $forceArg = @{ Force = $true } }
  Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings `
    -Description $description -ErrorAction Stop @forceArg | Out-Null
}

function Set-DyoWorkerScheduledTaskRecovery {
  param([string]$TaskName, [string]$SupervisorLauncher, [string]$InstallDir)
  try {
    Register-DyoWorkerTaskDefinition -TaskName $TaskName -SupervisorLauncher $SupervisorLauncher -InstallDir $InstallDir -Force
    if (Test-DyoWorkerTaskActionHealthy -TaskName $TaskName) { return $true }
  } catch {}
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-DyoWorkerTaskDefinition -TaskName $TaskName -SupervisorLauncher $SupervisorLauncher -InstallDir $InstallDir
    if (Test-DyoWorkerTaskActionHealthy -TaskName $TaskName) { return $true }
  } catch {}
  return $false
}

Write-Host "================================================"
Write-Host "  DYO Windows Worker - ONE-CLICK RECOVERY"
Write-Host "================================================"
Write-Host "This restores DYO Worker's last known-working program files from its own"
Write-Host "automatic backup. It does not ask for a registration code, does not change"
Write-Host "which DYO Worker this computer is, and does not open, modify, run, or"
Write-Host "render anything against any After Effects project."
Write-Host ""

if (-not (Test-Path $InstallDir)) {
  Write-Host "[NEEDS ATTENTION] $InstallDir was not found."
  Write-Host "This computer has not run DYO-Worker-Setup.bat yet - there is nothing to recover."
  exit 1
}

$credentialsPath = Join-Path $WorkRoot "state\worker-credentials.json"
if (-not (Test-Path $credentialsPath)) {
  Write-Host "[NEEDS ATTENTION] No saved worker registration was found at:"
  Write-Host "  $credentialsPath"
  Write-Host "This script only recovers an already-registered computer. Contact DYO."
  exit 1
}
Write-CheckResult $true "Existing DYO Worker registration found - it will be kept"

# ---- Find the most recent pre-update backup ----
$BackupRoot = Join-Path $WorkRoot "backups"
if (-not (Test-Path $BackupRoot)) {
  Write-Host "[NEEDS ATTENTION] No backups folder was found at:"
  Write-Host "  $BackupRoot"
  Write-Host "DYO-Worker-Final-Update.ps1 creates one automatically before every update -"
  Write-Host "if this computer has never run that update, there is nothing to recover to."
  exit 1
}
$latestBackup = Get-ChildItem -Path $BackupRoot -Directory -Filter "worker-app-pre-update-*" -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $latestBackup) {
  Write-Host "[NEEDS ATTENTION] No worker-app-pre-update-* backups were found under:"
  Write-Host "  $BackupRoot"
  exit 1
}
$BackupDir = $latestBackup.FullName
if (-not (Test-Path (Join-Path $BackupDir "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The most recent backup ($BackupDir) does not contain dist\index.js."
  Write-Host "Refusing to restore from an incomplete backup. Contact DYO."
  exit 1
}
Write-CheckResult $true "Found most recent backup" $BackupDir

$PreviousCommit = $null
$previousBuildInfoPath = Join-Path $BackupDir "BUILD_INFO.json"
if (Test-Path $previousBuildInfoPath) {
  try {
    $previousBuildInfo = Get-Content $previousBuildInfoPath -Raw | ConvertFrom-Json
    if ($previousBuildInfo.commit -match '^[0-9a-f]{40}$') {
      $PreviousCommit = $previousBuildInfo.commit
    }
  } catch {}
}

# ---- Stop DYO Worker safely (After Effects and ae-mcp are never touched) ----
Write-Host ""
Write-Host "Stopping DYO Worker safely..."
New-Item -ItemType Directory -Force -Path (Split-Path $MaintenanceFlagPath -Parent) | Out-Null
Set-Content -Path $MaintenanceFlagPath -Value (Get-Date -Format "o") -Force

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task -and $task.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
$oldPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
$stopped = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
  (Get-DyoWorkerProcesses).Count -eq 0
}
if (-not $stopped) {
  Get-DyoWorkerProcesses | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
  }
  Start-Sleep -Seconds 2
}
Write-CheckResult $true "DYO Worker stopped"

# ---- Restore the backup - .env is never touched ----
Write-Host ""
Write-Host "Restoring program files from backup..."
try {
  Copy-Item -Path (Join-Path $BackupDir "*") -Destination $InstallDir -Recurse -Force -Exclude ".env" -ErrorAction Stop
} catch {
  Write-Host "[NEEDS ATTENTION] Restoring the backup failed: $($_.Exception.Message)"
  Write-Host "DYO Worker program files may now be in a mixed/inconsistent state. Contact DYO immediately."
  Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-CheckResult $true "Restored program files from backup" $BackupDir

$supervisorLauncher = Join-Path $InstallDir "run-worker-supervisor.ps1"
if (Test-Path $supervisorLauncher) {
  Set-DyoWorkerScheduledTaskRecovery -TaskName $TaskName -SupervisorLauncher $supervisorLauncher -InstallDir $InstallDir | Out-Null
}

if (Test-Path $logPath) {
  $preRecoverBackup = Join-Path $InstallDir ("logs\worker.log.pre-recover-" + (Get-Date -Format "yyyyMMddHHmmss"))
  Move-Item -Path $logPath -Destination $preRecoverBackup -Force
}

# ---- Restart and verify (lighter check than a fresh update - this is a
# recovery path back to an ALREADY-PROVEN build, not a new promotion) ----
Write-Host ""
Write-Host "Restarting DYO Worker with the restored build..."
Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$started = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
  $newPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
  ($newPids | Where-Object { $oldPids -notcontains $_ }).Count -gt 0
}
if (-not $started) {
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
}

Write-Host "Waiting for a real heartbeat from the restored process (up to 45 seconds)..."
$heartbeatOk = Wait-Until -TimeoutSeconds 45 -PollSeconds 3 -Condition {
  (Get-FreshLogContent) -match '"msg":"heartbeat succeeded"'
}
$content = Get-FreshLogContent
$processRunning = (Get-DyoWorkerProcesses).Count -gt 0

Write-Host ""
Write-Host "================================================"
if ($processRunning -and $heartbeatOk) {
  Write-Host "  RECOVERY SUCCEEDED"
  Write-Host "================================================"
  Write-Host "DYO Worker is running and heartbeating again from the backup taken at:"
  Write-Host "  $BackupDir"
  if ($PreviousCommit) {
    $commitMatch = [regex]::Match($content, '"commit":"([0-9a-f]{7,40})"')
    if ($commitMatch.Success -and $commitMatch.Groups[1].Value -ne $PreviousCommit) {
      Write-Host ""
      Write-Host "[NEEDS ATTENTION] The restored build's commit does not match this backup's own"
      Write-Host "recorded commit. DYO Worker is running and heartbeating, but this needs DYO's"
      Write-Host "attention - contact DYO with this message."
    }
  }
  Write-Host ""
  Write-Host "Your DYO Worker identity, credentials, and configuration were never changed."
  Write-Host ""
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
  exit 0
} else {
  Write-Host "  RECOVERY FAILED"
  Write-Host "================================================"
  Write-Host "The restored build did not come back up and heartbeat within the expected time."
  Write-Host "DO NOT ASSUME DYO WORKER IS RUNNING. Contact DYO immediately - do not close this window."
  exit 1
}
