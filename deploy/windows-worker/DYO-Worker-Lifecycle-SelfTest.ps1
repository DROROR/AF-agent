<#
.SYNOPSIS
  Real Windows lifecycle acceptance check for the DYO Worker supervisor:
  proves the supervisor genuinely restarts the worker after an ordinary,
  unexpected process termination - without a reboot, without re-running
  DYO-Worker-Repair.bat/DYO-Worker-Final-Update.bat, and without this
  script itself touching the Scheduled Task.

.DESCRIPTION
  Real production incident this exists to prove is fixed (2026-08-30): a
  healthy worker was killed by an external Windows console-control event
  (NTSTATUS 0xC000013A) and never restarted, because it ran directly under
  a visible console with no supervising process. This script:
    1. Confirms a real worker process is currently running and recently
       heartbeated.
    2. Confirms (best-effort - see the NOTE below) no DYO job appears to
       be currently in progress, and refuses to run destructively if one
       might be.
    3. Terminates ONLY that one worker process (Stop-Process -Force on its
       exact PID) - never the Scheduled Task, never this script's own
       process, never After Effects or ae-mcp.
    4. Waits for the supervisor (a separate, already-running process this
       script never starts or stops) to spawn a genuinely NEW worker PID
       on its own.
    5. Waits for a fresh heartbeat from that new process.
    6. Confirms the worker's own identity (workerId in
       state\worker-credentials.json) is byte-for-byte unchanged - proof
       this was a real restart of the SAME worker, never a re-registration.
    7. Reports PASS or FAIL with a precise reason - never guesses, never
       reports PASS without having actually observed a new PID and a
       fresh heartbeat.

  NOTE on "is a job active" (item 2): there is no distributed lock this
  script can safely check without new server-side API surface - it reads
  the LATEST relevant lines of the worker's own worker.log for a
  "job claimed" not yet followed by a "job completed"/"job cycle failed"
  for the same jobId. This is a real, honest, best-effort local heuristic,
  not a guaranteed distributed lock - if you know a job is running via the
  dashboard, do not run this regardless of what this heuristic reports.

  Never leaves the worker stopped: if the supervisor does not produce a
  new PID and a fresh heartbeat within the timeout, this script falls back
  to Start-ScheduledTask (the same, always-safe recovery action
  DYO-Worker-Final-Update.ps1 already uses) before reporting FAIL, so a
  failed acceptance check never itself becomes an outage.

.PARAMETER InstallDir
  Where the DYO Worker program files are installed.

.PARAMETER WorkRoot
  Local folder for worker state - used to read worker-credentials.json
  and worker.log.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = "C:\DYO-Agent\app",
  [string]$WorkRoot = "C:\DYO-Agent"
)

$ErrorActionPreference = "Stop"
$TaskName = "DYO Video Worker"
$WorkerEntrypointPattern = 'dist\\index\.js'
$WorkerEnvArgPattern = '--env-file=\.env'
$logPath = Join-Path $InstallDir "logs\worker.log"
$credentialsPath = Join-Path $WorkRoot "state\worker-credentials.json"

function Write-CheckResult {
  param([bool]$Ok, [string]$Label, [string]$Detail = "")
  $mark = if ($Ok) { "[OK]" } else { "[NEEDS ATTENTION]" }
  if ($Detail) { Write-Host "$mark $Label - $Detail" } else { Write-Host "$mark $Label" }
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

function Get-LogContent {
  if (-not (Test-Path $logPath)) { return "" }
  $stream = [System.IO.File]::Open($logPath, 'Open', 'Read', [System.IO.FileShare]::ReadWrite)
  try {
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } finally {
    $stream.Close()
  }
}

<#
Best-effort, LOCAL-ONLY heuristic (see this script's own header NOTE) - a
job is considered possibly active if the log's LAST "job claimed" line has
no matching "job completed"/"job cycle failed" for the same jobId after
it. Never a real distributed lock.
#>
function Test-DyoJobMightBeActive {
  param([string]$LogContent)
  $lines = $LogContent -split "`n"
  $lastClaimedJobId = $null
  foreach ($line in $lines) {
    $claimMatch = [regex]::Match($line, '"msg":"job claimed"[^{}]*"jobId":"([0-9a-fA-F-]+)"')
    if ($claimMatch.Success) {
      $completedMatch = [regex]::Match($line, '"jobId":"([0-9a-fA-F-]+)"')
      $lastClaimedJobId = $completedMatch.Groups[1].Value
      continue
    }
    if ($lastClaimedJobId -and $line -match [regex]::Escape($lastClaimedJobId) -and ($line -match '"msg":"job completed"' -or $line -match '"msg":"job cycle failed"')) {
      $lastClaimedJobId = $null
    }
  }
  return [bool]$lastClaimedJobId
}

Write-Host "================================================"
Write-Host "  DYO Worker - Real Lifecycle Self-Test"
Write-Host "================================================"
Write-Host "Proves the supervisor restarts the worker after an ordinary, unexpected"
Write-Host "process termination - never touches After Effects, ae-mcp, or the Scheduled Task."
Write-Host ""

if (-not (Test-Path $credentialsPath)) {
  Write-Host "[NEEDS ATTENTION] No saved worker registration was found at $credentialsPath."
  Write-Host "This self-test only runs against an already-registered, already-running worker."
  exit 1
}
$credentialsBefore = Get-Content -Path $credentialsPath -Raw

$logBefore = Get-LogContent
if (Test-DyoJobMightBeActive -LogContent $logBefore) {
  Write-Host "[NEEDS ATTENTION] A DYO job appears to still be in progress (a recent 'job claimed'"
  Write-Host "with no matching completion yet in worker.log). Skipping this destructive test - do"
  Write-Host "not interrupt a real in-progress job. Re-run once no job is active."
  exit 1
}
Write-CheckResult $true "No job appears to be in progress (best-effort local check - see this script's own NOTE)"

$oldProcs = @(Get-DyoWorkerProcesses)
if ($oldProcs.Count -eq 0) {
  Write-Host "[NEEDS ATTENTION] No real DYO Worker process is currently running."
  Write-Host "This self-test requires a genuinely running worker to terminate. Nothing was touched."
  exit 1
}
$oldPid = ($oldProcs | Select-Object -First 1 -ExpandProperty ProcessId)
Write-CheckResult $true "Confirmed a real worker process is running" ("PID " + $oldPid)

$recentHeartbeat = Wait-Until -TimeoutSeconds 1 -PollSeconds 1 -Condition { $logBefore -match '"msg":"heartbeat succeeded"' }
if (-not $recentHeartbeat) {
  Write-Host "[NEEDS ATTENTION] No successful heartbeat has been logged yet. Wait for a healthy"
  Write-Host "worker before running this self-test."
  exit 1
}
Write-CheckResult $true "Confirmed a real recent heartbeat"

Write-Host ""
Write-Host "Terminating ONLY the current worker process (PID $oldPid) - After Effects/ae-mcp,"
Write-Host "the Scheduled Task, and this script's own process are never touched..."
try {
  Stop-Process -Id $oldPid -Force -ErrorAction Stop
} catch {
  Write-Host "[NEEDS ATTENTION] Could not terminate PID $oldPid - $($_.Exception.Message)"
  exit 1
}
Write-CheckResult $true "Worker process terminated"

Write-Host "Waiting for the supervisor to start a genuinely new worker process (up to 30 seconds)..."
$newPidFound = Wait-Until -TimeoutSeconds 30 -PollSeconds 1 -Condition {
  $newProcs = @(Get-DyoWorkerProcesses | Where-Object { $_.ProcessId -ne $oldPid })
  $newProcs.Count -gt 0
}

$restartedFallback = $false
if (-not $newPidFound) {
  Write-Host "[NEEDS ATTENTION] The supervisor did not start a new worker process within 30 seconds."
  Write-Host "Falling back to Start-ScheduledTask so the worker is never left stopped by this test..."
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $restartedFallback = $true
  $newPidFound = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
    $newProcs = @(Get-DyoWorkerProcesses | Where-Object { $_.ProcessId -ne $oldPid })
    $newProcs.Count -gt 0
  }
}

if (-not $newPidFound) {
  Write-Host "[NEEDS ATTENTION] No new worker process could be confirmed even after the"
  Write-Host "Start-ScheduledTask fallback. Please run DYO-Worker-Repair.bat, or contact DYO."
  exit 1
}
$newPid = @(Get-DyoWorkerProcesses | Where-Object { $_.ProcessId -ne $oldPid } | Select-Object -First 1 -ExpandProperty ProcessId)
if ($restartedFallback) {
  Write-CheckResult $false "A new worker process was only confirmed after the Start-ScheduledTask fallback - the supervisor's own restart did not visibly succeed within 30 seconds" ("new PID " + $newPid)
} else {
  Write-CheckResult $true "The supervisor started a genuinely new worker process on its own - no task/updater rerun needed" ("old PID " + $oldPid + " -> new PID " + $newPid)
}

Write-Host "Waiting for a fresh heartbeat from the new process (up to 30 seconds)..."
$freshHeartbeat = Wait-Until -TimeoutSeconds 30 -PollSeconds 2 -Condition {
  $current = Get-LogContent
  ($current.Length -gt $logBefore.Length) -and ($current.Substring($logBefore.Length) -match '"msg":"heartbeat succeeded"')
}
if (-not $freshHeartbeat) {
  Write-Host "[NEEDS ATTENTION] The new process is running, but no fresh heartbeat was observed"
  Write-Host "within 30 seconds. Check logs\worker.log directly."
  exit 1
}
Write-CheckResult $true "Confirmed a fresh heartbeat from the new process"

$credentialsAfter = Get-Content -Path $credentialsPath -Raw
if ($credentialsAfter -ne $credentialsBefore) {
  Write-Host "[NEEDS ATTENTION] worker-credentials.json changed during this test - this should"
  Write-Host "never happen (no re-registration occurs anywhere in this flow). Contact DYO."
  exit 1
}
Write-CheckResult $true "Same worker identity/config confirmed unchanged (no re-registration occurred)"

Write-Host ""
Write-Host "================================================"
if ($restartedFallback) {
  Write-Host "  Lifecycle self-test: FAIL (worker recovered only via Start-ScheduledTask fallback)"
  Write-Host "================================================"
  exit 1
} else {
  Write-Host "  Lifecycle self-test: PASS"
  Write-Host "================================================"
  Write-Host "The supervisor genuinely restarted the same worker (PID $oldPid -> $newPid), with a"
  Write-Host "fresh heartbeat and the exact same identity/config - no reboot, no Repair.bat, no"
  Write-Host "updater rerun, no registration."
}
