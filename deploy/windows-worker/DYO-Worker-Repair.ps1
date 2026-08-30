<#
.SYNOPSIS
  DYO Windows Worker - repair/update an ALREADY-REGISTERED install.
  Double-click DYO-Worker-Repair.bat instead of running this file directly.

.DESCRIPTION
  For a computer that has already completed DYO-Worker-Setup.bat once and
  has a saved worker-credentials.json. Updates the installed program files
  to the versions shipped in this package, rewrites .env with corrected
  configuration (see below), and re-registers the "DYO Video Worker"
  Scheduled Task - all WITHOUT touching the existing worker identity
  (WORKER_ID/WORKER_TOKEN in worker-credentials.json) and WITHOUT asking
  for a registration code.

  This exists specifically to ship configuration fixes to an already-
  registered machine without asking for a brand-new setup:
    - AE_PATH is now written (previously never written at all, so After
      Effects status always showed Unknown regardless of whether AE was
      running).
    - MCP health is no longer based on scanning ae-mcp's internal data
      files at all (that approach was replaced twice this session and both
      guessed wrong). The worker now runs the real, upstream-documented
      `node <AE_MCP_PATH>\dist\index.js health` CLI command (confirmed
      2026-08-24 directly from the upstream HeroicSwan/after-effects-mcp
      repository) and reads its exit code - no data-directory setting
      exists to write or get wrong anymore.

  Safety, same as DYO-Worker-Setup.ps1:
    - never asks for or stores a Windows account password.
    - never asks for a registration code - if no worker-credentials.json
      is found, this STOPS with a clear message instead of silently
      registering a new, duplicate worker identity. Run
      DYO-Worker-Setup.bat instead in that case.
    - WORKER_ID/WORKER_TOKEN are never read, written, or passed as
      arguments here - this script never even opens worker-credentials.json,
      it only checks that the file exists.
    - installed files remain restricted (via NTFS ACLs) to the current
      Windows user and SYSTEM.

.PARAMETER InstallDir
  Where the DYO Worker program files are installed.

.PARAMETER WorkRoot
  Local folder for worker state. Must match the value used at original
  setup time - defaults to the same "C:\DYO-Agent" DYO-Worker-Setup.ps1
  uses, and is confirmed against the existing .env below if present.

.PARAMETER AeMcpPath
  Where ae-mcp is installed. Unchanged from DYO-Worker-Setup.ps1's default.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = "C:\DYO-Agent\app",
  [string]$WorkRoot = "C:\DYO-Agent",
  [string]$AeMcpPath = "C:\AI-Tools\ae-mcp"
)

$ErrorActionPreference = "Stop"

# Must match DYO-Worker-Setup.ps1 exactly - this repairs/re-registers the
# same OS-level Scheduled Task, it does not create a second one. Re-
# registering a Scheduled Task by this name is purely a Windows Task
# Scheduler operation - it has nothing to do with the worker's own identity
# (WORKER_ID/WORKER_TOKEN), which lives only in worker-credentials.json and
# is never touched by this script.
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

function Set-OwnerOnlyAcl {
  <# Restricts a file/folder to the current user + SYSTEM via real NTFS ACLs - the only thing that means anything on Windows (POSIX chmod bits are a no-op here). #>
  param([string]$Path, [bool]$IsFile = $false)
  $rights = if ($IsFile) { "F" } else { "(OI)(CI)F" }
  icacls $Path /inheritance:r *>$null
  icacls $Path /grant:r "${env:USERNAME}:$rights" *>$null
  icacls $Path /grant:r "SYSTEM:$rights" *>$null
}

function Write-Utf8NoBomFile {
  <#
    Writes lines as UTF-8 WITHOUT a byte-order mark, using .NET directly -
    identical rationale and implementation to DYO-Worker-Setup.ps1's own
    Write-Utf8NoBomFile. Duplicated here (rather than shared via a module
    file) so this script stays a single, standalone, double-clickable file
    like every other script in this package - no new deployment mechanism
    introduced for one helper function.
  #>
  param([string]$Path, [string[]]$Lines)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($Path, $Lines, $utf8NoBom)
}

function Test-WorkerEnvReadableByNode {
  <#
    The only trustworthy way to know whether the real worker will see its
    configuration: ask Node, via the exact `node --env-file=.env` mechanism
    the worker itself uses - not PowerShell's Get-Content, which silently
    disagrees with Node about a leading BOM. Never prints values -
    dist\validate-env.js only ever prints key names.
  #>
  param([string]$InstallDir, [string[]]$RequiredKeys)
  Push-Location $InstallDir
  try {
    $nodeOutput = & node --env-file=.env dist\validate-env.js @RequiredKeys 2>&1
    return @{ Ok = ($LASTEXITCODE -eq 0); Output = $nodeOutput }
  } finally {
    Pop-Location
  }
}

Write-Host "================================================"
Write-Host "  DYO Windows Worker - Repair / Update"
Write-Host "================================================"
Write-Host "This updates an ALREADY-REGISTERED DYO Worker on this computer."
Write-Host "It does not ask for a registration code and does not change which"
Write-Host "DYO Worker identity this computer uses."
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
  Write-Host "DYO-Worker-Repair.bat only updates an existing install, it does not create one."
  exit 1
}

$credentialsPath = Join-Path $WorkRoot "state\worker-credentials.json"
if (-not (Test-Path $credentialsPath)) {
  Write-Host "[NEEDS ATTENTION] No saved worker registration was found at:"
  Write-Host "  $credentialsPath"
  Write-Host ""
  Write-Host "Repair only updates an already-registered computer - it never registers a new"
  Write-Host "one, to avoid creating a duplicate DYO Worker identity. If this computer has"
  Write-Host "never been registered (or its saved registration was deleted), please run"
  Write-Host "DYO-Worker-Setup.bat instead, which will ask for a one-time registration code."
  exit 1
}
Write-CheckResult $true "Existing DYO Worker registration found - it will be kept"

$aeExePath = "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe"
if (-not (Test-Path $aeExePath)) {
  Write-Host "[NEEDS ATTENTION] After Effects 2026 was not found at the expected location:"
  Write-Host "  $aeExePath"
  Write-Host "Repair cannot confirm the correct AE_PATH to write. Install/reinstall After"
  Write-Host "Effects 2026 at the expected location and run DYO-Worker-Repair.bat again."
  exit 1
}
Write-CheckResult $true "After Effects 2026"

# The worker's MCP health check and inspection transport both invoke
# exactly `node <AE_MCP_PATH>\dist\index.js <fixed subcommand>` (confirmed
# against the real upstream HeroicSwan/after-effects-mcp package.json).
$aeMcpEntryPoint = Join-Path $AeMcpPath "dist\index.js"
if (-not (Test-Path $aeMcpEntryPoint)) {
  Write-Host "[NEEDS ATTENTION] ae-mcp's dist\index.js was not found under:"
  Write-Host "  $AeMcpPath"
  Write-Host "Repair cannot confirm ae-mcp is actually installed there. Re-check the ae-mcp"
  Write-Host "installation and run DYO-Worker-Repair.bat again."
  exit 1
}
Write-CheckResult $true "ae-mcp"

# ---- Step 2: update program files ----

Write-Host ""
Write-Host "Updating DYO Worker program files..."

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker repair package and try again."
  exit 1
}

# .env is rewritten explicitly below, from scratch, with values this script
# resolves itself - never copied over by this bulk file copy. Excluded here
# so a stale worker-app/.env template (there isn't one, but never rely on
# that implicitly) can never overwrite the real installed configuration.
Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force -Exclude ".env"
Write-CheckResult $true "Updated DYO Worker program files"

Write-Host "Updating runtime dependencies (only needs internet access once)..."
Push-Location $InstallDir
& npm install --omit=dev --no-audit --no-fund *>$null
$npmExitCode = $LASTEXITCODE
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Updating runtime dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-Repair.bat."
  exit 1
}
Write-CheckResult $true "Updated runtime dependencies"

foreach ($dir in @($WorkRoot, $InstallDir)) {
  Set-OwnerOnlyAcl -Path $dir -IsFile $false
}

# ---- Step 3: rewrite .env with corrected configuration ----
#
# DYO_API_URL is explicitly KEPT from the existing .env rather than
# re-derived, per the repair requirement to never silently change where
# this worker points. Everything else is recomputed the same way
# DYO-Worker-Setup.ps1 would compute it today - including AE_PATH, the fix
# this script exists to deliver.
Write-Host ""
Write-Host "Updating configuration..."

$envPath = Join-Path $InstallDir ".env"
$existingApiUrl = $null
if (Test-Path $envPath) {
  $existingLine = Get-Content -Path $envPath | Where-Object { $_ -match '^DYO_API_URL=' } | Select-Object -First 1
  if ($existingLine) {
    $existingApiUrl = $existingLine.Substring("DYO_API_URL=".Length)
  }
}
if ([string]::IsNullOrWhiteSpace($existingApiUrl)) {
  Write-Host "[NEEDS ATTENTION] Could not read the existing DYO_API_URL from:"
  Write-Host "  $envPath"
  Write-Host "Repair keeps the existing API address rather than guessing one - please"
  Write-Host "contact DYO rather than running this again on its own."
  exit 1
}

$workerName = $env:COMPUTERNAME

$envLines = @(
  "DYO_API_URL=$existingApiUrl"
  "WORKER_NAME=$workerName"
  "AE_PATH=$aeExePath"
  "AE_MCP_PATH=$AeMcpPath"
  "WORK_ROOT=$WorkRoot"
)
# No WORKER_REGISTRATION_SECRET line, ever - this script never asks for or
# writes a registration code. resolveWorkerCredentials() in
# apps/worker/src/bootstrap.ts prefers the persisted worker-credentials.json
# over any registration secret anyway, so none is needed for an already-
# registered worker to keep running under its existing identity.
Write-Utf8NoBomFile -Path $envPath -Lines $envLines
Set-OwnerOnlyAcl -Path $envPath -IsFile $true

$envCheck = Test-WorkerEnvReadableByNode -InstallDir $InstallDir -RequiredKeys @(
  "DYO_API_URL", "AE_PATH", "AE_MCP_PATH"
)
if (-not $envCheck.Ok) {
  Write-Host "[NEEDS ATTENTION] Node cannot read the configuration file this repair just wrote."
  Write-Host "Please run DYO-Worker-Repair.bat again. If this keeps happening, contact DYO."
  exit 1
}
Write-CheckResult $true "Configuration file is complete and readable by Node"

# ---- Step 4: re-register the automatic-startup Scheduled Task ----
#
# Re-registering under the same $TaskName replaces the task's action so it
# points at the just-updated run-worker.bat, and keeps the same trigger
# semantics DYO-Worker-Setup.ps1 uses - it does not create a second task
# and does not affect worker-credentials.json in any way.
Write-Host ""
Write-Host "Updating automatic startup..."

$logsDir = Join-Path $InstallDir "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Set-OwnerOnlyAcl -Path $logsDir -IsFile $false

$wasRunning = $false
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
  $wasRunning = $existingTask.State -eq "Running"
  if ($wasRunning) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Points at the HIDDEN supervisor launcher, never at run-worker.bat
# directly - real production bug (2026-08-30): a visible, session-attached
# console window running the worker directly let an external
# console-control event (or simply the window being closed) kill it with
# NTSTATUS 0xC000013A and no restart. See DYO-Worker-Setup.ps1's own
# comment on this same change for the full explanation.
$supervisorLauncher = Join-Path $InstallDir "run-worker-supervisor.ps1"
if (-not (Test-Path $supervisorLauncher)) {
  Write-Host "[NEEDS ATTENTION] run-worker-supervisor.ps1 is missing from the installed files."
  Write-Host "Re-download the full DYO Worker repair package and try again."
  exit 1
}
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisorLauncher`"" `
  -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Runs the DYO Video Worker automatically when $env:USERNAME logs into Windows. Installed/updated by DYO-Worker-Repair.ps1 - safe to remove via DYO-Worker-Uninstall.bat." `
  | Out-Null

Write-CheckResult $true "Automatic startup updated (starts at Windows logon)"

Write-Host "Starting DYO Worker now..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "================================================"
Write-Host "  Repair complete"
Write-Host "================================================"
Write-Host "DYO Worker is running with the updated configuration, using the same DYO"
Write-Host "Worker identity this computer already had - no new registration was created."
Write-Host ""
$logPath = Join-Path $logsDir "worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
