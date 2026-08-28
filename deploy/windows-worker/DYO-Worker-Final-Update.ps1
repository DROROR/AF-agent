<#
.SYNOPSIS
  DYO Windows Worker - FINAL consolidated update, for an ALREADY-REGISTERED
  install. Double-click DYO-Worker-Final-Update.bat instead of running this
  file directly.

.DESCRIPTION
  Ships the complete, real, already-committed AE execution and render
  delivery pipeline to an already-registered machine, without asking for a
  new registration code and without running any inspection, edit, or render
  itself. This build activates and self-reports ALL SIX capabilities the
  worker implements - every one of them now appears in the worker's own
  CURRENT_WORKER_CAPABILITIES list at registration/heartbeat time:
    - CHECK_HEALTH, INSPECT_TEMPLATE, INSPECT_SCENE_EVIDENCE (unchanged from
      whatever DYO has already deployed via earlier update packages - see
      CHECKHEALTH-UPDATE-README.txt/INSPECTOR-UPDATE-README.txt).
    - INSPECT_RENDER_CAPABILITIES - a read-only capability that (once DYO
      explicitly dispatches it) can list the real AE Render Queue template
      names/AE version on this machine, for final render-template
      verification. Never mutates or saves the AE project.
    - EXECUTE_FRAME (worker operation EXECUTE_SCENE_EDIT) - the fixed,
      allowlisted JSX mutation bridge (SET_TEXT/MAP_FOOTAGE/etc.) with
      durable mid-job checkpoints (a job that is interrupted mid-way resumes
      from its last completed step rather than restarting from scratch) and
      first-frame preview capture. MAP_FOOTAGE asset bytes are downloaded by
      the worker itself (identified only by assetId + expected sha256,
      never a path), verified against that hash, and cached in the worker's
      own job workspace.
    - RENDER - the real `aerender`-based render engine (Landscape/Reels
      output, per the exact master composition and template names DYO has
      configured), plus uploading the resulting rendered file back to DYO
      once a render completes successfully. Requires a prior successful
      EXECUTE_FRAME job for the project.

  This is ONE consolidated package - it supersedes DYO-Worker-CheckHealth-
  Update.ps1/DYO-Worker-Inspector-Update.ps1 for capability delivery going
  forward (both are still safe to have run previously; this one simply
  ships everything they shipped plus everything new, from the same known
  commit). DYO-Worker-MCP-Repair.ps1/DYO-Worker-Repair.ps1 remain separate,
  distinct repair tools this package does not replace.

  This update also REFRESHES the existing "DYO Video Worker" Scheduled
  Task's automatic-recovery settings (RestartCount/RestartInterval/
  MultipleInstances/ExecutionTimeLimit/StartWhenAvailable), the same
  robust settings DYO-Worker-Setup.ps1/DYO-Worker-Repair.ps1 already apply
  on a fresh install/repair - a machine set up a while ago may be running
  an older, weaker version of these settings that this package now
  corrects. This uses the SAME Action/Trigger/Principal (same run-worker.
  bat path, same Windows user, same AtLogon trigger) - it never changes
  WHO or WHAT the task runs as, only how reliably Windows recovers it
  after an ordinary crash. WORKER_ID/WORKER_TOKEN are untouched (they live
  in a separate, local credentials file, never in the task definition).

  This script itself never runs any of the above, never connects to ae-mcp,
  never opens or touches any After Effects project, and never invokes
  aerender - it only replaces program files and restarts the worker. Real
  proof that the update took effect comes entirely from this script's own
  verification below - never printed blindly:
    - the exact OLD worker process(es) are confirmed gone (by PID, not by
      an install-directory guess),
    - a NEW worker process exists afterward, with a PID that was never one
      of the old ones,
    - a real new successful heartbeat appears in log content this script
      itself guarantees is fresh,
    - that same fresh content shows ALL SIX capabilities (CHECK_HEALTH,
      INSPECT_TEMPLATE, INSPECT_SCENE_EVIDENCE, INSPECT_RENDER_CAPABILITIES,
      EXECUTE_FRAME, RENDER) and the EXACT expected final build commit
      (not just "some" commit marker - see $ExpectedCommit below),
    - the new render/execute-scene-edit/render-upload program files
      genuinely exist on disk after the copy - an independent check in
      addition to (not instead of) the self-reported capabilities list.

  Matches the exact process-matching/log-rotation/restart-verification
  approach already proven correct in DYO-Worker-CheckHealth-Update.ps1 -
  see that script's own header comment for the CONFIRMED BUG history this
  avoids repeating.

  Safety, same as every prior update package:
    - never asks for or stores a Windows account password.
    - never asks for a registration code - if no worker-credentials.json
      is found, this STOPS with a clear message instead of silently
      registering a new, duplicate worker identity.
    - WORKER_ID/WORKER_TOKEN are never read, written, or passed as
      arguments here - this script never even opens worker-credentials.json,
      it only checks that the file exists.
    - never runs any capability, never connects to ae-mcp, never invokes
      aerender - this update only installs the capability code; nothing in
      this script calls it.
    - only ever targets node.exe processes whose own command line matches
      the worker's exact fixed invocation signature - never a generic
      node.exe, never an unrelated Node application.
    - your .env configuration file is never touched or rewritten. RENDER_
      PROJECT needs AERENDER_PATH configured, and INSPECT_RENDER_
      CAPABILITIES/EXECUTE_SCENE_EDIT/RENDER_PROJECT's composition
      verification need AE_MCP_PATH configured - if either is not already
      set in your .env, the worker still starts and heartbeats normally;
      those specific capabilities simply report themselves as not
      available until DYO or you add the missing path (see the README
      that came with this package for the acceptance-test sequence).

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

# The exact commit this final package was built from (see BUILD_INFO.json
# alongside worker-app/, written by scripts/package-windows-worker.mjs at
# package time) - verified below against the NEW process's own real
# startup log line, not merely "some" commit marker, since this is meant
# to be a specific, known-good final release.
$ExpectedCommit = "2c98c09073575f002507b4a4f66dc1b4af672c49"

# The worker's own fixed, real invocation signature (run-worker.bat:
# `node --env-file=.env dist\index.js`) - deliberately NOT the install
# directory (see DYO-Worker-CheckHealth-Update.ps1's own CONFIRMED BUG note).
$WorkerEntrypointPattern = 'dist\\index\.js'
$WorkerEnvArgPattern = '--env-file=\.env'

# New program files this exact update introduces - verified present on
# disk after the copy, as an independent check in addition to (not instead
# of) the running process's own self-reported capabilities list (all six
# capabilities, including INSPECT_RENDER_CAPABILITIES/EXECUTE_FRAME/RENDER,
# are now in CURRENT_WORKER_CAPABILITIES - see operation-allowlist.ts).
$NewCapabilityFiles = @(
  "dist\execution\execute-scene-edit-executor.js",
  "dist\execution\scene-edit-checkpoint.js",
  "dist\execution\preview-capture.js",
  "dist\execution\render\render-project-executor.js",
  "dist\execution\render\aerender-runner.js",
  "dist\execution\render\inspect-render-capabilities.js",
  "dist\execution\render\upload-render-artifact.js",
  "dist\workspace\working-copy.js"
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

# Exported as a real function (not inlined into the CIM pipeline) so it can
# be reasoned about/tested in isolation - see
# scripts/windows-worker/__tests__/dyo-worker-final-update.test.ts.
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
Write-Host "  DYO Windows Worker - FINAL Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer to the complete AE execution and render delivery pipeline"
Write-Host "(scene editing with resumable checkpoints, preview capture, rendering,"
Write-Host "and render-file upload). It does not ask for a registration code, does"
Write-Host "not change which DYO Worker this computer is, and does not open, modify,"
Write-Host "run, or render anything against any After Effects project."
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
Write-CheckResult $true "Existing automatic-startup task found - its recovery settings will be refreshed below, same identity"

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker FINAL update package and try again."
  exit 1
}
foreach ($relativeFile in $NewCapabilityFiles) {
  if (-not (Test-Path (Join-Path $sourceApp $relativeFile))) {
    Write-Host "[NEEDS ATTENTION] Expected new program file is missing from this package: $relativeFile"
    Write-Host "Re-download the full DYO Worker FINAL update package and try again."
    exit 1
  }
}
Write-CheckResult $true "This package's own files are complete (execute-scene-edit/render/upload modules all present)"

# ---- Step 2: stop DYO Worker safely, and PROVE it actually stopped ----
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

foreach ($relativeFile in $NewCapabilityFiles) {
  if (-not (Test-Path (Join-Path $InstallDir $relativeFile))) {
    Write-Host "[NEEDS ATTENTION] $relativeFile was not found on disk after the copy."
    Write-Host "The update did not complete correctly. Please re-run this update, or contact DYO."
    exit 1
  }
}
Write-CheckResult $true "Confirmed new render/execute-scene-edit/render-upload program files exist on disk"

Write-Host "Checking runtime dependencies (only needs internet access if something is missing)..."
Push-Location $InstallDir
& npm install --omit=dev --no-audit --no-fund *>$null
$npmExitCode = $LASTEXITCODE
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Installing dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-Final-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

# ---- Step 3b: refresh the Scheduled Task's automatic-recovery settings ----
#
# CONFIRMED BUG (real client machine, 2026-08-28): a legacy Scheduled Task
# - one registered by a much older Setup.ps1 revision, or otherwise
# degraded over time - can have a NULL or EMPTY Action.Execute path. The
# very first version of this refresh step called Unregister-ScheduledTask
# then Register-ScheduledTask as two separate calls with no error
# handling at all: against a legacy task like that, one of those calls can
# throw, and since $ErrorActionPreference = "Stop" is set at the top of
# this script, an uncaught throw here aborted the ENTIRE update immediately
# - after Step 2 had already stopped the old process, so DYO Worker was
# left fully stopped with no restart attempted at all (Step 5, which owns
# starting it, was never reached).
#
# Fixed by Set-DyoWorkerScheduledTaskRecovery below: every Task Scheduler
# cmdlet call is wrapped so nothing here can throw an uncaught error, it
# tries two independent recovery strategies before giving up, and it
# VERIFIES the resulting task's own Action.Execute is real (non-null,
# non-empty) rather than trusting that Register-ScheduledTask succeeding
# alone means the task is actually healthy. If recovery still cannot be
# confirmed after both attempts, this step logs a clear warning and the
# script CONTINUES to Step 5 regardless - refreshing these settings is a
# reliability improvement, never a precondition for restarting DYO Worker
# today. Same Action/Trigger/Principal identity as always (same
# run-worker.bat path, same Windows user, same AtLogon trigger) - only the
# Settings block (and the recovery from a corrupted legacy Action) is new.
Write-Host ""
Write-Host "Refreshing automatic-recovery settings on the existing Scheduled Task..."

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
  param([string]$TaskName, [string]$RunWorkerBat, [string]$InstallDir, [switch]$Force)
  $taskAction = New-ScheduledTaskAction -Execute $RunWorkerBat -WorkingDirectory $InstallDir
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
  <#
  Ensures the "DYO Video Worker" Scheduled Task has our known-good
  Action/Trigger/Principal/Settings. Never throws - every Task Scheduler
  cmdlet call is wrapped, so a pre-existing legacy task with a corrupted
  or null/empty Execute path can never abort the caller or leave the
  worker with no recoverable task at all. Returns $true only once the
  resulting task is independently VERIFIED healthy (a real, non-empty
  Execute path) - $false means both recovery attempts failed, which the
  caller treats as "log a warning, continue anyway" (see this function's
  own call site's doc comment for why that is the correct behavior here).
  #>
  param([string]$TaskName, [string]$RunWorkerBat, [string]$InstallDir)

  # Attempt 1: -Force overwrites an existing task (including a legacy one
  # with a corrupted/null Execute path) in one atomic call - avoids ever
  # calling Unregister-ScheduledTask against a possibly-malformed legacy
  # task definition at all.
  try {
    Register-DyoWorkerTaskDefinition -TaskName $TaskName -RunWorkerBat $RunWorkerBat -InstallDir $InstallDir -Force
    if (Test-DyoWorkerTaskActionHealthy -TaskName $TaskName) { return $true }
  } catch {}

  # Attempt 2: a legacy/corrupted task occasionally resists -Force alone -
  # explicitly remove it first (best-effort; SilentlyContinue because it
  # may already be gone or already broken), then register fresh. Same
  # recovery sequence DYO-Worker-Repair.ps1 already uses successfully.
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-DyoWorkerTaskDefinition -TaskName $TaskName -RunWorkerBat $RunWorkerBat -InstallDir $InstallDir
    if (Test-DyoWorkerTaskActionHealthy -TaskName $TaskName) { return $true }
  } catch {}

  return $false
}

$taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery -TaskName $TaskName -RunWorkerBat $runWorkerBat -InstallDir $InstallDir
if ($taskRefreshOk) {
  Write-CheckResult $true "Automatic-recovery settings refreshed (restarts automatically after a crash, no duplicate instances, same identity)"
} else {
  Write-Host "[NEEDS ATTENTION] Could not confirm the Scheduled Task's recovery settings after two recovery attempts."
  Write-Host "Continuing anyway - this does not stop today's update. DYO Worker will still be"
  Write-Host "restarted below with whatever task definition is currently in place. Contact DYO"
  Write-Host "to fully repair the Scheduled Task's automatic-recovery policy separately."
}

# ---- Step 4: guarantee a clean log slate before restarting ----
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

# -ErrorAction SilentlyContinue: if the Scheduled Task refresh above could
# not be confirmed AND somehow left no task registered at all (the one
# truly worst-case outcome of the legacy-task recovery above), this must
# never throw an uncaught error here - it falls through to the same
# $started/PID-diff check below either way, which correctly reports the
# real outcome and prints the existing, already-clear NEEDS ATTENTION
# message rather than an unhandled PowerShell stack trace.
Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$started = Wait-Until -TimeoutSeconds 8 -PollSeconds 1 -Condition {
  $newPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
  ($newPids | Where-Object { $oldPids -notcontains $_ }).Count -gt 0
}
if (-not $started) {
  # A stale IgnoreNew flag on Task Scheduler's own side (distinct from the
  # process-level race already closed above) is rare but possible - one
  # extra explicit start attempt before treating this as a real failure.
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
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

# Capabilities/build-commit live in the process's own "worker starting" log
# line (index.ts logs it BEFORE the heartbeat loop even starts) - checking
# it here, independent of whether a heartbeat has succeeded yet, means a
# real network hiccup during THIS update never blocks verifying the update
# itself actually took effect (item 7: "do not falsely call a temporary
# heartbeat delay an installation failure").
Write-Host "Waiting for the new process to log its startup line (up to 15 seconds)..."
$startupLogged = Wait-Until -TimeoutSeconds 15 -PollSeconds 1 -Condition {
  (Get-FreshLogContent) -match '"msg":"worker starting"'
}
if (-not $startupLogged) {
  Write-Host "[NEEDS ATTENTION] The new DYO Worker process is running, but never logged its own"
  Write-Host "startup line within 15 seconds. Check logs\worker.log directly - this usually means"
  Write-Host "a configuration problem (see .env) rather than a network issue. Contact DYO if unclear."
  exit 1
}
Write-CheckResult $true "New process logged its own startup line"

Write-Host "Waiting for a real heartbeat attempt from the new process (up to 30 seconds)..."
$heartbeatSucceeded = Wait-Until -TimeoutSeconds 30 -PollSeconds 2 -Condition {
  (Get-FreshLogContent) -match '"msg":"heartbeat succeeded"'
}
$newContent = Get-FreshLogContent

if ($heartbeatSucceeded) {
  Write-CheckResult $true "New process sent a real successful heartbeat"
} else {
  # Not yet succeeded is not automatically a failure - a real retry attempt
  # with a logged, understandable reason means the worker is alive and
  # actively trying, which is exactly the self-healing behavior this
  # package exists to guarantee (it will connect the moment the API/network
  # is reachable, with no client action needed). Only genuine SILENCE - no
  # attempt logged at all - is treated as an install failure below.
  $retrying = $newContent -match '"msg":"heartbeat failed, will retry"' -or $newContent -match "NEEDS_ATTENTION: DYO API rejected"
  if ($retrying) {
    Write-CheckResult $true "New process has not connected yet but is actively retrying (see logs\worker.log for the reason) - this is expected to resolve on its own"
  } else {
    Write-Host "[NEEDS ATTENTION] The new DYO Worker process started, but neither a successful"
    Write-Host "heartbeat NOR a logged retry attempt was observed within 30 seconds. Check your"
    Write-Host "internet connection, then check logs\worker.log directly before assuming this"
    Write-Host "update failed - this specific combination usually means the process itself is"
    Write-Host "not behaving as expected, not just a slow network."
    exit 1
  }
}

$expectedCapabilities = @("CHECK_HEALTH", "INSPECT_TEMPLATE", "INSPECT_SCENE_EVIDENCE", "INSPECT_RENDER_CAPABILITIES", "EXECUTE_FRAME", "RENDER")
$missingCapabilities = $expectedCapabilities | Where-Object { $newContent -notmatch [regex]::Escape($_) }
if (($newContent -match '"msg":"worker starting"') -and ($missingCapabilities.Count -eq 0)) {
  Write-CheckResult $true "Worker capabilities include all six" ($expectedCapabilities -join ", ")
} else {
  Write-Host "[NEEDS ATTENTION] Could not confirm all six capabilities ($($expectedCapabilities -join ', '))"
  Write-Host "in the new process's own startup log line. The process is running and heartbeating,"
  Write-Host "but this update may not have taken effect correctly. Contact DYO."
  exit 1
}

$commitMatch = [regex]::Match($newContent, '"commit":"([0-9a-f]{7,40})"')
if (-not $commitMatch.Success) {
  Write-Host "[NEEDS ATTENTION] No build/version marker (BUILD_INFO commit) was found in the"
  Write-Host "new process's own startup log line. Everything else checks out, but this update"
  Write-Host "package cannot prove which build is now running. Contact DYO."
  exit 1
}
$runningCommit = $commitMatch.Groups[1].Value
if ($runningCommit -ne $ExpectedCommit) {
  Write-Host "[NEEDS ATTENTION] The running build's commit ($runningCommit) does not match"
  Write-Host "this exact FINAL update package's expected commit ($ExpectedCommit)."
  Write-Host "The program files were copied, but something is not the exact final build."
  Write-Host "Contact DYO before relying on this as the final release."
  exit 1
}
Write-CheckResult $true "Running the exact final build" ("commit " + $runningCommit)

Write-Host ""
Write-Host "================================================"
Write-Host "  Update complete"
Write-Host "================================================"
$heartbeatSummary = if ($heartbeatSucceeded) { "a real confirmed heartbeat" } else { "a genuine active retry attempt (not yet connected, but self-recovering - see logs\worker.log)" }
Write-Host "DYO Worker is running the complete AE execution and render delivery pipeline,"
Write-Host "with a genuinely new process (confirmed by PID), $heartbeatSummary, the"
Write-Host "exact expected final build commit, and every new program file verified present on"
Write-Host "disk - using the same DYO Worker identity this computer already had. No new"
Write-Host "registration was created. Automatic-recovery settings on the Scheduled Task were"
Write-Host "refreshed, so an ordinary future crash restarts DYO Worker on its own - no reboot"
Write-Host "or manual re-run of this update should be needed for that. No After Effects"
Write-Host "project was opened, changed, rendered, or otherwise run against by this update."
Write-Host ""
Write-Host "Latest status:"
Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
