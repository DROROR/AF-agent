<#
.SYNOPSIS
  DYO Windows Worker - FINAL consolidated update, for an ALREADY-REGISTERED
  install. Double-click DYO-Worker-Final-Update.bat instead of running this
  file directly.

.DESCRIPTION
  Ships the complete, real, already-committed AE execution and render
  delivery pipeline to an already-registered machine, without asking for a
  new registration code and without running any inspection, edit, or render
  itself. This build activates and self-reports ALL SEVEN capabilities the
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
    - CREATE_PREVIEW (client-handoff completion phase) - a real, full-
      duration complete-preview video of the session's current cumulative
      working copy, produced through the exact same real `aerender`
      process RENDER uses, against the project's own already-configured
      LANDSCAPE render output identity. This is a review artifact, not a
      final deliverable - it does not approve itself and does not trigger
      a final render. Uploaded back to DYO once created successfully.
      Requires a prior successful EXECUTE_FRAME job for the project, same
      as RENDER.

  This is ONE consolidated package - it supersedes DYO-Worker-CheckHealth-
  Update.ps1/DYO-Worker-Inspector-Update.ps1 for capability delivery going
  forward (both are still safe to have run previously; this one simply
  ships everything they shipped plus everything new, from the same known
  commit). DYO-Worker-MCP-Repair.ps1/DYO-Worker-Repair.ps1 remain separate,
  distinct repair tools this package does not replace.

  This update also REFRESHES the "DYO Video Worker" Scheduled Task's
  automatic-recovery settings (RestartCount/RestartInterval/
  MultipleInstances/ExecutionTimeLimit/StartWhenAvailable), the same
  robust settings DYO-Worker-Setup.ps1/DYO-Worker-Repair.ps1 already apply
  on a fresh install/repair - a machine set up a while ago may be running
  an older, weaker version of these settings that this package now
  corrects. If the task itself is MISSING entirely (registration and
  config are still valid, but the task was removed - by antivirus/cleanup
  software or a manual mistake), this update RECREATES it automatically
  using this computer's existing WORKER_ID/WORKER_TOKEN/config - it does
  not ask the client to run a separate repair package for that. Either
  way this uses the SAME Action/Trigger/Principal (same Windows user,
  same AtLogon trigger) - it never changes WHO the task runs as, only how
  reliably Windows recovers it after an ordinary crash, and it never
  re-registers. WORKER_ID/WORKER_TOKEN are untouched (they live in a
  separate, local credentials file, never in the task definition).

  REAL PRODUCTION INCIDENT (2026-08-30): a healthy worker - real ONLINE
  heartbeats, a real job completed, AE/MCP both ONLINE - simply stopped,
  with the Scheduled Task left at State "Ready" and LastTaskResult
  0xC000013A (STATUS_CONTROL_C_EXIT: an unhandled Windows console-control
  event - Ctrl+Break, the console window being closed, or the interactive
  session ending). RestartCount/RestartInterval never fired, because that
  policy does not reliably cover a Task-Scheduler/OS-initiated stop of a
  session-attached console task, only the worker process failing on its
  own. Root cause: the worker ran directly under a VISIBLE console window
  in the user's own interactive session, with no handler for the signals
  Windows actually delivers for those events (SIGBREAK/SIGHUP). Fixed by
  changing the Task's Action to a small, HIDDEN supervisor (a
  `powershell.exe -WindowStyle Hidden` launcher starting a Node
  supervisor process - see run-worker-supervisor.ps1 and
  apps/worker/src/supervisor/) that spawns the real worker as a hidden
  (windowsHide:true, no console window at all - nothing to close) child
  and restarts it automatically after any ordinary/unexpected exit, with
  a short bounded backoff. This update refreshes the Action to point at
  that supervisor instead of running the worker directly - Trigger/
  Principal/Settings (AtLogOn, Interactive, RestartCount 999,
  RestartInterval 1 minute, ExecutionTimeLimit unlimited, MultipleInstances
  IgnoreNew) are UNCHANGED, so Task Scheduler's own recovery remains the
  outer safety net protecting the supervisor itself. During this update,
  state\maintenance.flag (under WorkRoot) is set before stopping DYO
  Worker and cleared only once the refreshed task has been started again
  - the supervisor checks this flag before every restart attempt, so an
  ordinary ongoing crash-restart can never race this update's own file
  replacement.

  This script itself never runs any of the above, never connects to ae-mcp,
  never opens or touches any After Effects project, and never invokes
  aerender - it only replaces program files and restarts the worker. Real
  proof that the update took effect comes entirely from this script's own
  verification below - never printed blindly:
    - the exact OLD worker process(es) are confirmed gone (by PID, not by
      an install-directory guess),
    - a NEW worker process ideally exists afterward with a PID that was
      never one of the old ones - PID-diff is the preferred, first-checked
      signal, but a failed PID match no longer hard-fails the update on
      its own (real incident, 2026-08-30: a process-matching regression
      meant a genuinely healthy, ONLINE, heartbeating worker's PID was
      never observed - see $WorkerEntrypointPattern below); the log-
      content checks immediately below are independent, deeper proof and
      are what a failed PID match falls through to instead of failing
      outright,
    - a real new successful heartbeat appears in log content this script
      itself guarantees is fresh,
    - that same fresh content shows ALL SEVEN capabilities (CHECK_HEALTH,
      INSPECT_TEMPLATE, INSPECT_SCENE_EVIDENCE, INSPECT_RENDER_CAPABILITIES,
      EXECUTE_FRAME, RENDER, CREATE_PREVIEW) and the EXACT expected final build commit
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

# The exact commit this final package was built from - read below, once
# $sourceApp is known, directly from THIS SAME package's own
# worker-app\BUILD_INFO.json (written by scripts/package-windows-worker.mjs
# at package time - see the read below). Deliberately NEVER a second,
# separately-maintained literal here: a real release once shipped with
# this value hand-copied from a PRIOR build and never updated for the new
# one, so the running worker (genuinely the new commit) failed this exact
# check against a stale expectation - reading the one real source
# BUILD_INFO.json itself, already inside this same package, makes that
# whole class of drift structurally impossible going forward.

# The worker's own fixed, real invocation signature - `node --env-file=.env
# dist\index.js`, spawned by the supervisor (supervisor/spawn-worker-child.ts,
# via path.join - always backslash on the real win32 target) exactly as
# run-worker.bat always ran it - deliberately NOT the install directory
# (see DYO-Worker-CheckHealth-Update.ps1's own CONFIRMED BUG note: run-
# worker.bat's invocation is always relative, so an install-directory-
# anchored matcher can never find it in the real CommandLine at all).
# Tolerant of either path separator ([\\/]) as defense in depth - a real
# client-machine bug (2026-08-30) had the worker running fine, ONLINE,
# heartbeating, while this matcher (backslash-only at the time) silently
# never matched it because the spawn call briefly used a forward slash;
# fixed at the source (spawn-worker-child.ts), but this tolerance costs
# nothing and guards against that exact class of regression recurring.
# Never matches the supervisor's own process (dist\supervisor\index.js -
# a different path, "supervisor\" breaks the required dist-then-index
# adjacency regardless of which separator is used).
$WorkerEntrypointPattern = 'dist[\\/]index\.js'
$WorkerEnvArgPattern = '--env-file=\.env'

# New program files this exact update introduces - verified present on
# disk after the copy, as an independent check in addition to (not instead
# of) the running process's own self-reported capabilities list (all seven
# capabilities, including INSPECT_RENDER_CAPABILITIES/EXECUTE_FRAME/RENDER/
# CREATE_PREVIEW, are now in CURRENT_WORKER_CAPABILITIES - see operation-allowlist.ts).
$NewCapabilityFiles = @(
  "dist\execution\execute-scene-edit-executor.js",
  "dist\execution\scene-edit-checkpoint.js",
  "dist\execution\preview-capture.js",
  "dist\execution\render\render-project-executor.js",
  "dist\execution\render\aerender-runner.js",
  "dist\execution\render\inspect-render-capabilities.js",
  "dist\execution\render\upload-render-artifact.js",
  "dist\workspace\working-copy.js",
  "dist\execution\preview\create-full-preview-executor.js",
  "dist\execution\preview\upload-full-preview.js",
  "dist\execution\preview\full-preview-output-path.js"
)

# This exact update's own new files - the hidden supervisor (verified
# present on disk both before AND after the copy, same convention as
# $NewCapabilityFiles above).
$NewSupervisorFiles = @(
  "run-worker-supervisor.ps1",
  "dist\supervisor\index.js"
)

# Set BEFORE stopping DYO Worker below, cleared only once the refreshed
# task has been started again - the single authoritative "is maintenance
# in progress" signal apps/worker/src/supervisor/maintenance-flag.ts
# checks before every restart attempt. Never touches the worker's saved
# identity/credentials - a plain marker file, nothing else.
$MaintenanceFlagPath = Join-Path $WorkRoot "state\maintenance.flag"

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
# launched (the hidden powershell.exe launcher, which starts a Node
# supervisor, which spawns the actual worker as ITS OWN child), not the
# worker process several levels down, so the task's own reported State is
# never trusted alone.
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

# Defined early (before Step 1) since $InstallDir is already known from this
# script's own parameters - both the update's own verification AND the
# final success/rollback summaries all read from this same path.
$logPath = Join-Path $InstallDir "logs\worker.log"

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
  # powershell.exe -WindowStyle Hidden, never run-worker.bat directly - see
  # this script's own header comment on the real 2026-08-30 incident this
  # fixes (a visible, session-attached console let an external
  # console-control event kill the worker with no restart).
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
  <#
  Ensures the "DYO Video Worker" Scheduled Task has our known-good
  Action/Trigger/Principal/Settings. Never throws - every Task Scheduler
  cmdlet call is wrapped, so a pre-existing legacy task with a corrupted
  or null/empty Execute path can never abort the caller or leave the
  worker with no recoverable task at all. Returns $true only once the
  resulting task is independently VERIFIED healthy (a real, non-empty
  Execute path) - $false means both recovery attempts failed, which the
  caller treats as "log a warning, continue anyway".
  #>
  param([string]$TaskName, [string]$SupervisorLauncher, [string]$InstallDir)

  # Attempt 1: -Force overwrites an existing task (including a legacy one
  # with a corrupted/null Execute path) in one atomic call.
  try {
    Register-DyoWorkerTaskDefinition -TaskName $TaskName -SupervisorLauncher $SupervisorLauncher -InstallDir $InstallDir -Force
    if (Test-DyoWorkerTaskActionHealthy -TaskName $TaskName) { return $true }
  } catch {}

  # Attempt 2: a legacy/corrupted task occasionally resists -Force alone -
  # explicitly remove it first (best-effort), then register fresh.
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-DyoWorkerTaskDefinition -TaskName $TaskName -SupervisorLauncher $SupervisorLauncher -InstallDir $InstallDir
    if (Test-DyoWorkerTaskActionHealthy -TaskName $TaskName) { return $true }
  } catch {}

  return $false
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

# A missing "DYO Video Worker" task (real client-machine case, 2026-08-30:
# a valid registration and config existed, but the task itself was gone -
# most likely removed by antivirus/cleanup software or a manual mistake,
# not by anything this updater did) used to hard-STOP here and send the
# client to a separate DYO-Worker-Repair.bat run. That is no longer
# necessary: Set-DyoWorkerScheduledTaskRecovery below (Step 3b) already
# knows how to create the task from scratch with the exact same hardened
# recovery settings the full Repair installer uses, using this computer's
# EXISTING registration/config - it never re-registers, never asks for a
# code, and never touches the worker's saved identity/credentials.
# $taskWasMissing only
# changes the wording of the messages below; it does not change what gets
# run - the same recovery function handles "missing" and "corrupted"
# identically (Register-ScheduledTask with -Force creates a task that does
# not exist yet just as well as it repairs one that does).
$taskWasMissing = -not $task
if ($taskWasMissing) {
  Write-CheckResult $true "The `"$TaskName`" automatic-startup task was not found - it will be recreated automatically below, using this computer's existing registration and configuration (no repair package needed)"
} else {
  Write-CheckResult $true "Existing automatic-startup task found - its recovery settings will be refreshed below, same identity"
}

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker FINAL update package and try again."
  exit 1
}
foreach ($relativeFile in ($NewCapabilityFiles + $NewSupervisorFiles)) {
  if (-not (Test-Path (Join-Path $sourceApp $relativeFile))) {
    Write-Host "[NEEDS ATTENTION] Expected new program file is missing from this package: $relativeFile"
    Write-Host "Re-download the full DYO Worker FINAL update package and try again."
    exit 1
  }
}
Write-CheckResult $true "This package's own files are complete (execute-scene-edit/render/upload/supervisor modules all present)"

# The one real, canonical release identity for this exact package - read
# directly from this same worker-app/'s own BUILD_INFO.json (written by
# scripts/package-windows-worker.mjs from a real `git rev-parse HEAD` at
# package time), never a second, hand-maintained literal that could drift
# out of sync with the program files sitting right next to it.
$buildInfoPath = Join-Path $sourceApp "BUILD_INFO.json"
if (-not (Test-Path $buildInfoPath)) {
  Write-Host "[NEEDS ATTENTION] worker-app\BUILD_INFO.json is missing from this package - cannot determine its expected release commit."
  Write-Host "Re-download the full DYO Worker FINAL update package and try again."
  exit 1
}
$buildInfo = Get-Content $buildInfoPath -Raw | ConvertFrom-Json
if (-not ($buildInfo.commit -match '^[0-9a-f]{40}$')) {
  Write-Host "[NEEDS ATTENTION] worker-app\BUILD_INFO.json does not contain a real 40-character commit hash."
  Write-Host "Re-download the full DYO Worker FINAL update package and try again."
  exit 1
}
$ExpectedCommit = $buildInfo.commit
Write-CheckResult $true "This package's own expected release commit" $ExpectedCommit

# ---- Step 2: stop DYO Worker safely, and PROVE it actually stopped ----
Write-Host ""
Write-Host "Stopping DYO Worker safely..."

# Set BEFORE anything is stopped - see the maintenance-flag doc comment
# above. Cleared only once the refreshed task has been started again
# (Step 5) - if this update fails/exits partway through, a stale flag left
# behind would wrongly stop the worker from ever self-healing again, so a
# failure below is expected to be followed by contacting DYO to clear it
# manually rather than assuming the worker will recover on its own.
New-Item -ItemType Directory -Force -Path (Split-Path $MaintenanceFlagPath -Parent) | Out-Null
Set-Content -Path $MaintenanceFlagPath -Value (Get-Date -Format "o") -Force

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

# ---- Step 2b: back up the currently-installed program files BEFORE touching anything ----
#
# Real safety requirement: if the new build somehow starts but never
# genuinely proves itself healthy (a subtle regression, not just a
# transient network blip), the replace step below would otherwise have
# already overwritten the previous, known-working program files with
# nothing left to restore. This backup is taken AFTER the old process is
# confirmed stopped (so nothing is still writing to the files being
# copied) and BEFORE any replacement happens, and is independently
# verified non-empty before the script proceeds - never trusted to have
# simply "worked" because Copy-Item did not throw. See Invoke-WorkerRollback
# below for how this is restored if the update's own health gate fails.
Write-Host ""
Write-Host "Backing up current program files before updating (for automatic rollback if needed)..."
$BackupRoot = Join-Path $WorkRoot "backups"
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$BackupDir = Join-Path $BackupRoot ("worker-app-pre-update-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Copy-Item -Path (Join-Path $InstallDir "*") -Destination $BackupDir -Recurse -Force -ErrorAction Stop
if (-not (Test-Path (Join-Path $BackupDir "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The pre-update backup does not contain dist\index.js - refusing to proceed."
  Write-Host "No program files have been changed. Nothing was updated. Contact DYO if this repeats."
  Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-CheckResult $true "Backed up current program files" $BackupDir

# The commit this backup represents, if known - read from the CURRENTLY
# INSTALLED BUILD_INFO.json (an install predating this field, e.g. from
# the very first Setup.ps1 revision, simply will not have one; rollback
# below still works either way, it just cannot assert a specific expected
# commit for the restored build in that case).
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

# ==== Steps 3-5: replace program files, refresh task, restart, and verify ====
# Wrapped in a function (rather than the previous top-level script flow) so
# a health-gate failure triggers automatic rollback to the backup just
# taken above, instead of leaving the machine with the old process already
# stopped and the new one broken/unverified/unchecked. Every failure path
# below sets $script:FailureReason (a short, one-sentence summary safe to
# show in the rollback report) in addition to printing the SAME detailed
# [NEEDS ATTENTION] guidance the pre-rollback version of this script
# already printed, and returns $false instead of calling exit 1 directly -
# exit 1 is now reserved for genuinely-unrecoverable pre-flight failures
# (Step 1/backup, above) where nothing has been changed yet and there is
# nothing to roll back.
$script:FailureReason = $null
$script:HeartbeatSucceeded = $false
$script:PidConfirmed = $false
$script:RunningCommit = $null

function Invoke-WorkerUpdateAndVerify {
  # ---- Step 3: replace only the program files - .env is never touched ----
  Write-Host ""
  Write-Host "Updating DYO Worker program files..."
  Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force -Exclude ".env"
  Write-CheckResult $true "Updated DYO Worker program files"

  foreach ($relativeFile in ($NewCapabilityFiles + $NewSupervisorFiles)) {
    if (-not (Test-Path (Join-Path $InstallDir $relativeFile))) {
      Write-Host "[NEEDS ATTENTION] $relativeFile was not found on disk after the copy."
      Write-Host "The update did not complete correctly. Please re-run this update, or contact DYO."
      $script:FailureReason = "A new program file was missing after copying ($relativeFile)"
      return $false
    }
  }
  Write-CheckResult $true "Confirmed new render/execute-scene-edit/render-upload/supervisor program files exist on disk"

  Write-Host "Checking runtime dependencies (only needs internet access if something is missing)..."
  Push-Location $InstallDir
  & npm install --omit=dev --no-audit --no-fund *>$null
  $npmExitCode = $LASTEXITCODE
  Pop-Location
  if ($npmExitCode -ne 0) {
    Write-Host "[NEEDS ATTENTION] Installing dependencies failed."
    Write-Host "Check your internet connection and re-run DYO-Worker-Final-Update.bat."
    $script:FailureReason = "Installing runtime dependencies (npm install) failed"
    return $false
  }
  Write-CheckResult $true "Runtime dependencies are up to date"

  $supervisorLauncher = Join-Path $InstallDir "run-worker-supervisor.ps1"
  if (-not (Test-Path $supervisorLauncher)) {
    Write-Host "[NEEDS ATTENTION] run-worker-supervisor.ps1 is missing from the installed files after the update."
    Write-Host "Re-download the full DYO Worker FINAL update package and try again, or contact DYO."
    $script:FailureReason = "run-worker-supervisor.ps1 missing after the update"
    return $false
  }

  # ---- Step 3b: refresh the Scheduled Task's automatic-recovery settings ----
  Write-Host ""
  Write-Host "Refreshing automatic-recovery settings on the existing Scheduled Task..."
  $taskRefreshOk = Set-DyoWorkerScheduledTaskRecovery -TaskName $TaskName -SupervisorLauncher $supervisorLauncher -InstallDir $InstallDir
  if ($taskRefreshOk -and $taskWasMissing) {
    Write-CheckResult $true "Automatic-startup task recreated (same worker identity, hardened recovery settings - no repair package needed)"
  } elseif ($taskRefreshOk) {
    Write-CheckResult $true "Automatic-recovery settings refreshed (restarts automatically after a crash, no duplicate instances, same identity)"
  } elseif ($taskWasMissing) {
    Write-Host "[NEEDS ATTENTION] The automatic-startup task was missing and could not be recreated after two attempts."
    Write-Host "Still attempting to start DYO Worker directly below - if that also fails, please run"
    Write-Host "DYO-Worker-Repair.bat (the full repair), or contact DYO."
  } else {
    Write-Host "[NEEDS ATTENTION] Could not confirm the Scheduled Task's recovery settings after two recovery attempts."
    Write-Host "Continuing anyway - this does not stop today's update. DYO Worker will still be"
    Write-Host "restarted below with whatever task definition is currently in place. Contact DYO"
    Write-Host "to fully repair the Scheduled Task's automatic-recovery policy separately."
  }

  # ---- Step 4: guarantee a clean log slate before restarting ----
  if (Test-Path $logPath) {
    $preUpdateBackup = Join-Path $InstallDir ("logs\worker.log.pre-update-" + (Get-Date -Format "yyyyMMddHHmmss"))
    Move-Item -Path $logPath -Destination $preUpdateBackup -Force
  }

  # ---- Step 5: restart DYO Worker, and PROVE the update actually took effect ----
  Write-Host ""
  Write-Host "Restarting DYO Worker with the updated program files..."

  # Cleared BEFORE starting the task - a freshly-started supervisor checks
  # this flag before its very first spawn attempt.
  Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue

  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $started = Wait-Until -TimeoutSeconds 8 -PollSeconds 1 -Condition {
    $newPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
    ($newPids | Where-Object { $oldPids -notcontains $_ }).Count -gt 0
  }
  if (-not $started) {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $started = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
      $newPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
      ($newPids | Where-Object { $oldPids -notcontains $_ }).Count -gt 0
    }
  }
  $pidConfirmed = $started
  $script:PidConfirmed = $pidConfirmed
  if (-not $pidConfirmed) {
    Write-Host "[NEEDS ATTENTION] Could not confirm a new DYO Worker process by PID after restart."
    Write-Host "Continuing to check the worker's own log content directly - a real, healthy,"
    Write-Host "heartbeating worker with unconfirmed PID is a known possible process-matching gap,"
    Write-Host "not necessarily a real failure. This will still trigger automatic rollback below if"
    Write-Host "the log itself does not show a genuine, correctly-built, connected worker."
  } else {
    Write-CheckResult $true "A genuinely new DYO Worker process is running (PID differs from before)"
  }

  Write-Host "Waiting for the new process to log its startup line (up to 15 seconds)..."
  $startupLogged = Wait-Until -TimeoutSeconds 15 -PollSeconds 1 -Condition {
    (Get-FreshLogContent) -match '"msg":"worker starting"'
  }
  if (-not $startupLogged) {
    Write-Host "[NEEDS ATTENTION] The new DYO Worker process is running, but never logged its own"
    Write-Host "startup line within 15 seconds. Check logs\worker.log directly - this usually means"
    Write-Host "a configuration problem (.env) rather than a network issue."
    $script:FailureReason = "New process never logged its own startup line within 15 seconds"
    return $false
  }
  Write-CheckResult $true "New process logged its own startup line"

  # Requires TWO real, successful heartbeats - not just one, and never
  # merely "retrying". A single lucky heartbeat, or a process that starts
  # but cannot keep a stable connection, both self-heal below via automatic
  # rollback instead of being reported as a false success. The window
  # (90 seconds) comfortably covers several real HEARTBEAT_INTERVAL_MS
  # cycles (15s default) with margin for real network latency.
  Write-Host "Waiting for TWO real, successful heartbeats from the new process (up to 90 seconds -"
  Write-Host "proves an ongoing healthy connection, not just a lucky first attempt)..."
  $heartbeatLinePattern = '\{[^{}]*"msg":"heartbeat succeeded"[^{}]*\}'
  $heartbeatsOk = Wait-Until -TimeoutSeconds 90 -PollSeconds 3 -Condition {
    $matchCount = ([regex]::Matches((Get-FreshLogContent), $heartbeatLinePattern)).Count
    $matchCount -ge 2
  }
  $newContent = Get-FreshLogContent
  $heartbeatLines = [regex]::Matches($newContent, $heartbeatLinePattern)
  $script:HeartbeatSucceeded = $heartbeatsOk

  if (-not $heartbeatsOk) {
    Write-Host "[NEEDS ATTENTION] Did not observe two real, successful heartbeats within 90 seconds"
    Write-Host "(found $($heartbeatLines.Count)). Check your internet connection and logs\worker.log."
    $script:FailureReason = "Fewer than two real heartbeats succeeded within 90 seconds (found $($heartbeatLines.Count))"
    return $false
  }
  Write-CheckResult $true "Two or more real, successful heartbeats confirmed" ("$($heartbeatLines.Count) heartbeats observed")

  # AE ONLINE / MCP ONLINE / maxConcurrency - read directly from the MOST
  # RECENT successful heartbeat's own structured log fields (already sent
  # to DYO on every heartbeat - see apps/worker/src/index.ts's
  # logHeartbeatEvent), never guessed or assumed from the process merely
  # running.
  $latestHeartbeatLine = $heartbeatLines[$heartbeatLines.Count - 1].Value
  $aeOnline = $latestHeartbeatLine -match '"aeStatus":"ONLINE"'
  $mcpOnline = $latestHeartbeatLine -match '"mcpStatus":"ONLINE"'
  if (-not ($aeOnline -and $mcpOnline)) {
    Write-Host "[NEEDS ATTENTION] Latest heartbeat does not report both AE and MCP ONLINE:"
    Write-Host "  $latestHeartbeatLine"
    Write-Host "This often just means After Effects is not open yet - open it and wait a minute,"
    Write-Host "or re-run this update once it is."
    $script:FailureReason = "Latest heartbeat does not report both AE and MCP as ONLINE"
    return $false
  }
  Write-CheckResult $true "Latest heartbeat reports AE ONLINE and MCP ONLINE"

  $maxConcurrencyOk = $latestHeartbeatLine -match '"maxConcurrency":1\b'
  if (-not $maxConcurrencyOk) {
    Write-Host "[NEEDS ATTENTION] Latest heartbeat does not report the expected maxConcurrency (1)."
    $script:FailureReason = "Latest heartbeat does not report the expected maxConcurrency (1)"
    return $false
  }
  Write-CheckResult $true "Latest heartbeat reports the expected maxConcurrency (1)"

  $expectedCapabilities = @("CHECK_HEALTH", "INSPECT_TEMPLATE", "INSPECT_SCENE_EVIDENCE", "INSPECT_RENDER_CAPABILITIES", "EXECUTE_FRAME", "RENDER", "CREATE_PREVIEW")
  $missingCapabilities = $expectedCapabilities | Where-Object { $newContent -notmatch [regex]::Escape($_) }
  if (($newContent -match '"msg":"worker starting"') -and ($missingCapabilities.Count -eq 0)) {
    Write-CheckResult $true "Worker capabilities include all seven" ($expectedCapabilities -join ", ")
  } else {
    Write-Host "[NEEDS ATTENTION] Could not confirm all seven capabilities ($($expectedCapabilities -join ', '))"
    Write-Host "in the new process's own startup log line. The process is running and heartbeating,"
    Write-Host "but this update may not have taken effect correctly."
    $script:FailureReason = "Could not confirm all seven expected capabilities in the startup log"
    return $false
  }

  $commitMatch = [regex]::Match($newContent, '"commit":"([0-9a-f]{7,40})"')
  if (-not $commitMatch.Success) {
    Write-Host "[NEEDS ATTENTION] No build/version marker (BUILD_INFO commit) was found in the"
    Write-Host "new process's own startup log line. Everything else checks out, but this update"
    Write-Host "package cannot prove which build is now running."
    $script:FailureReason = "No BUILD_INFO commit marker found in the startup log"
    return $false
  }
  $runningCommit = $commitMatch.Groups[1].Value
  $script:RunningCommit = $runningCommit
  if ($runningCommit -ne $ExpectedCommit) {
    Write-Host "[NEEDS ATTENTION] The running build's commit ($runningCommit) does not match"
    Write-Host "this exact FINAL update package's expected commit ($ExpectedCommit)."
    Write-Host "The program files were copied, but something is not the exact final build."
    $script:FailureReason = "Running commit ($runningCommit) does not match the expected commit ($ExpectedCommit)"
    return $false
  }
  Write-CheckResult $true "Running the exact final build" ("commit " + $runningCommit)

  return $true
}

# ==== Automatic rollback - restores the pre-update backup and proves it is
# healthy again, so a failed update never leaves the machine with no
# runnable worker. Same maintenance-flag discipline as the main update
# (set before stopping, cleared only once the restored worker is running
# again) so the supervisor's own self-healing never races this restore. ====
function Invoke-WorkerRollback {
  param([string]$Reason)

  Write-Host ""
  Write-Host "================================================"
  Write-Host "  UPDATE FAILED - ROLLING BACK AUTOMATICALLY"
  Write-Host "================================================"
  Write-Host "Reason: $Reason"
  Write-Host ""
  Write-Host "Restoring the previous, known-working DYO Worker build from the backup taken"
  Write-Host "before this update started. Your DYO Worker identity/credentials/config are"
  Write-Host "never touched by this - only program files are being restored."
  Write-Host ""

  New-Item -ItemType Directory -Force -Path (Split-Path $MaintenanceFlagPath -Parent) | Out-Null
  Set-Content -Path $MaintenanceFlagPath -Value (Get-Date -Format "o") -Force

  Write-Host "Stopping the failed new DYO Worker process..."
  $currentTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($currentTask -and $currentTask.State -eq "Running") {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  $rollbackOldPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
  $stoppedForRollback = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
    (Get-DyoWorkerProcesses).Count -eq 0
  }
  if (-not $stoppedForRollback) {
    Get-DyoWorkerProcesses | ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
    }
    Start-Sleep -Seconds 2
  }

  Write-Host "Restoring program files from backup: $BackupDir"
  try {
    Copy-Item -Path (Join-Path $BackupDir "*") -Destination $InstallDir -Recurse -Force -Exclude ".env" -ErrorAction Stop
  } catch {
    Write-Host "[NEEDS ATTENTION] Restoring the backup itself failed: $($_.Exception.Message)"
    Write-Host "DYO Worker program files may now be in a mixed/inconsistent state."
    Write-Host "Run DYO-Worker-Recover.bat now, or contact DYO immediately - do not close this window."
    Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue
    return $false
  }
  Write-CheckResult $true "Restored previous program files from backup"

  $rollbackSupervisorLauncher = Join-Path $InstallDir "run-worker-supervisor.ps1"
  if (Test-Path $rollbackSupervisorLauncher) {
    Set-DyoWorkerScheduledTaskRecovery -TaskName $TaskName -SupervisorLauncher $rollbackSupervisorLauncher -InstallDir $InstallDir | Out-Null
  }

  if (Test-Path $logPath) {
    $rollbackLogBackup = Join-Path $InstallDir ("logs\worker.log.pre-rollback-" + (Get-Date -Format "yyyyMMddHHmmss"))
    Move-Item -Path $logPath -Destination $rollbackLogBackup -Force
  }

  Write-Host "Restarting the restored (previous) DYO Worker build..."
  Remove-Item -Path $MaintenanceFlagPath -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $rollbackStarted = Wait-Until -TimeoutSeconds 20 -PollSeconds 1 -Condition {
    $newPids = @((Get-DyoWorkerProcesses) | Select-Object -ExpandProperty ProcessId)
    ($newPids | Where-Object { $rollbackOldPids -notcontains $_ }).Count -gt 0
  }
  if (-not $rollbackStarted) {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
  }

  Write-Host "Waiting for the restored process to confirm a real heartbeat (up to 45 seconds)..."
  $rollbackHeartbeatOk = Wait-Until -TimeoutSeconds 45 -PollSeconds 3 -Condition {
    (Get-FreshLogContent) -match '"msg":"heartbeat succeeded"'
  }
  $rollbackContent = Get-FreshLogContent
  $rollbackProcessRunning = (Get-DyoWorkerProcesses).Count -gt 0

  if (-not ($rollbackProcessRunning -and $rollbackHeartbeatOk)) {
    Write-Host "[NEEDS ATTENTION] The restored previous build did not come back up and heartbeat"
    Write-Host "within the expected time. DYO Worker may not be running at all right now."
    Write-Host "Run DYO-Worker-Recover.bat now, or contact DYO immediately."
    return $false
  }

  if ($PreviousCommit) {
    $rollbackCommitMatch = [regex]::Match($rollbackContent, '"commit":"([0-9a-f]{7,40})"')
    if ($rollbackCommitMatch.Success -and $rollbackCommitMatch.Groups[1].Value -ne $PreviousCommit) {
      Write-Host "[NEEDS ATTENTION] The restored build's commit does not match the pre-update commit."
      Write-Host "DYO Worker is running and heartbeating, but this needs DYO's attention."
      return $false
    }
  }

  Write-CheckResult $true "Restored DYO Worker is running and heartbeating again (previous known-working build)"
  return $true
}

$updateOk = Invoke-WorkerUpdateAndVerify

if ($updateOk) {
  Write-Host ""
  Write-Host "================================================"
  Write-Host "  Update complete"
  Write-Host "================================================"
  $heartbeatSummary = "at least two real confirmed heartbeats"
  $processConfirmationSummary = if ($script:PidConfirmed) { "a genuinely new process (confirmed by PID)" } else { "a genuinely running process (confirmed by its own fresh log content - PID could not be independently confirmed this time, see above)" }
  Write-Host "DYO Worker is running the complete AE execution and render delivery pipeline,"
  Write-Host "with $processConfirmationSummary, $heartbeatSummary, AE and MCP both confirmed"
  Write-Host "ONLINE, the expected maxConcurrency, the exact expected final build commit, and"
  Write-Host "every new program file verified present on disk - using the same DYO Worker"
  Write-Host "identity this computer already had. No new registration was created. Automatic-"
  Write-Host "recovery settings on the Scheduled Task were refreshed, so an ordinary future"
  Write-Host "crash restarts DYO Worker on its own - no reboot or manual re-run of this update"
  Write-Host "should be needed for that. No After Effects project was opened, changed,"
  Write-Host "rendered, or otherwise run against by this update."
  Write-Host ""
  Write-Host "A pre-update backup of the previous build remains at:"
  Write-Host "  $BackupDir"
  Write-Host "(safe to delete once you are satisfied this update is working well)."
  Write-Host ""
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
  exit 0
}

$rollbackOk = Invoke-WorkerRollback -Reason $script:FailureReason

Write-Host ""
Write-Host "================================================"
if ($rollbackOk) {
  Write-Host "  UPDATE FAILED - ROLLED BACK SAFELY"
  Write-Host "================================================"
  Write-Host "The new build ($ExpectedCommit) did not pass its post-update health check:"
  Write-Host "  $($script:FailureReason)"
  Write-Host ""
  Write-Host "DYO Worker has been automatically restored to its previous, known-working build"
  Write-Host "and is confirmed running and heartbeating again. Your DYO Worker identity,"
  Write-Host "credentials, and configuration were never changed. Nothing was left broken."
  Write-Host "Contact DYO with this message before trying the update again."
  exit 1
} else {
  Write-Host "  UPDATE FAILED - AUTOMATIC ROLLBACK COULD NOT BE FULLY VERIFIED"
  Write-Host "================================================"
  Write-Host "The new build did not pass its post-update health check, and this script could"
  Write-Host "not fully confirm the previous build was restored and healthy either."
  Write-Host ""
  Write-Host "DO NOT ASSUME DYO WORKER IS RUNNING. Run DYO-Worker-Recover.bat now (in this same"
  Write-Host "folder) - it restores the last known-working backup without asking for a"
  Write-Host "registration code or changing any credentials/configuration. Contact DYO"
  Write-Host "immediately if that does not resolve it."
  exit 1
}
