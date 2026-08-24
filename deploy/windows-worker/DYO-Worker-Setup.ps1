<#
.SYNOPSIS
  DYO Windows Worker - one-time setup. Double-click DYO-Worker-Setup.bat
  instead of running this file directly.

.DESCRIPTION
  Checks prerequisites, installs the DYO Worker runtime into a dedicated
  local folder, registers this computer with DYO using a one-time
  registration code, and sets up a Windows Scheduled Task ("DYO Video
  Worker") so the worker starts automatically at logon from then on - no
  manual start, no terminal, ever, for normal daily use. No terminal
  knowledge is required - every step below prints a plain-English status
  line.

  Safety:
    - never runs arbitrary shell/PowerShell/JSX against After Effects -
      this script only installs and configures the worker process itself.
    - never asks for or stores a Windows account password - the scheduled
      task uses an "at logon, current user" trigger, which needs no stored
      credential.
    - the one-time registration code is entered with masked input, is never
      printed to screen or written to any log file, and is deleted from
      local configuration immediately after a successful registration.
      WORKER_ID/WORKER_TOKEN are never passed as Scheduled Task arguments -
      the worker reads its own persisted credentials file at startup.
    - installed files are restricted (via NTFS ACLs, not chmod - chmod does
      not mean anything on Windows) to the current Windows user and SYSTEM.

.PARAMETER ApiUrl
  The DYO API endpoint. Defaults to the real production endpoint - only
  override this for testing against a different environment.

.PARAMETER AeMcpPath
  Where ae-mcp is installed.

.PARAMETER InstanceFilePath
  Where ae-mcp's per-instance state file lives.

.PARAMETER WorkRoot
  Local folder for worker state (registration, logs). Nothing outside this
  folder (and the install folder below) is ever written to.

.PARAMETER InstallDir
  Where the DYO Worker program files are installed.
#>

[CmdletBinding()]
param(
  [string]$ApiUrl = "https://worker-api.dyocourses.com",
  [string]$AeMcpPath = "C:\AI-Tools\ae-mcp",
  [string]$InstanceFilePath = "C:\Users\PC\ae-mcp\instances\default\instance.json",
  [string]$WorkRoot = "C:\DYO-Agent",
  [string]$InstallDir = "C:\DYO-Agent\app"
)

$ErrorActionPreference = "Stop"

# Shared with DYO-Worker-Stop.bat and DYO-Worker-Uninstall.bat - must match exactly.
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

function Remove-RegistrationSecretFromEnv {
  <#
    Strips the WORKER_REGISTRATION_SECRET line from a .env file - the code
    is only ever needed once. Deliberately reads the full file into a
    variable FIRST, then writes, as two separate statements - never a
    single `Get-Content $path | ... | Set-Content $path` pipeline against
    the same file, which is a well-known PowerShell anti-pattern that can
    truncate the file if Set-Content begins writing before Get-Content has
    finished streaming from it. This function exists once so both call
    sites (registration failure and registration success) get the same
    safe behavior instead of duplicating the pattern.
  #>
  param([string]$Path)
  $remainingLines = Get-Content -Path $Path | Where-Object { $_ -notmatch '^WORKER_REGISTRATION_SECRET=' }
  Set-Content -Path $Path -Value $remainingLines -Encoding utf8
}

Write-Host "================================================"
Write-Host "  DYO Windows Worker - Setup"
Write-Host "================================================"
Write-Host "This checks your computer, installs the DYO Worker, and connects"
Write-Host "it to DYO. It takes a few minutes. You will be asked for a"
Write-Host "one-time registration code partway through."
Write-Host ""

# ---- Step 1: prerequisite checks (all read-only) ----

$blockers = New-Object System.Collections.Generic.List[string]

try {
  $nodeVersionRaw = (& node -v).Trim()
  $nodeMajor = [int]($nodeVersionRaw.TrimStart('v').Split('.')[0])
  if ($nodeMajor -ge 24) {
    Write-CheckResult $true "Node.js" "found $nodeVersionRaw"
  } else {
    Write-CheckResult $false "Node.js" "found $nodeVersionRaw, need 24 or newer"
    $blockers.Add("Node.js 24 or newer is required (found $nodeVersionRaw). Install it from https://nodejs.org and re-run this setup.")
  }
} catch {
  Write-CheckResult $false "Node.js" "not found"
  $blockers.Add("Node.js was not found. Install Node.js 24 from https://nodejs.org and re-run this setup.")
}

$aeExePath = "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe"
if (Test-Path $aeExePath) {
  Write-CheckResult $true "After Effects 2026"
} else {
  Write-CheckResult $false "After Effects 2026" "not found at the expected location"
  $blockers.Add("After Effects 2026 was not found at: $aeExePath")
}

if (Test-Path $AeMcpPath) {
  Write-CheckResult $true "ae-mcp"
} else {
  Write-CheckResult $false "ae-mcp" "not found at $AeMcpPath"
  $blockers.Add("ae-mcp was not found at: $AeMcpPath")
}

# The instance file is informational, not a hard blocker - the worker
# already handles a missing file honestly (MCP status shows Unknown rather
# than failing to start). See apps/worker/src/health/mcp-instance-file-adapter.ts.
if (Test-Path $InstanceFilePath) {
  Write-CheckResult $true "ae-mcp status file"
} else {
  Write-CheckResult $false "ae-mcp status file" "not found yet - After Effects status will show as Unknown until this exists"
}

try {
  $apiHost = ([Uri]$ApiUrl).Host
  $netTest = Test-NetConnection -ComputerName $apiHost -Port 443 -WarningAction SilentlyContinue
  if ($netTest.TcpTestSucceeded) {
    Write-CheckResult $true "Connection to DYO"
  } else {
    Write-CheckResult $false "Connection to DYO" "cannot reach $apiHost"
    $blockers.Add("Cannot reach $apiHost over the internet. Check your network/firewall and try again.")
  }
} catch {
  Write-CheckResult $false "Connection to DYO" "check failed"
  $blockers.Add("Could not check the connection to DYO: $($_.Exception.Message)")
}

if ($blockers.Count -gt 0) {
  Write-Host ""
  Write-Host "Setup cannot continue yet. Please fix the following, then run DYO-Worker-Setup.bat again:"
  foreach ($b in $blockers) {
    Write-Host "  - $b"
  }
  exit 1
}

# ---- Step 2: install the runtime ----

Write-Host ""
Write-Host "All checks passed. Installing DYO Worker..."

New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker setup package and try again."
  exit 1
}
Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force
Write-CheckResult $true "Copied DYO Worker program files"

Write-Host "Installing runtime dependencies (only needs internet access once)..."
Push-Location $InstallDir
& npm install --omit=dev --no-audit --no-fund *>$null
$npmExitCode = $LASTEXITCODE
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Installing runtime dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-Setup.bat."
  exit 1
}
Write-CheckResult $true "Installed runtime dependencies"

foreach ($dir in @($WorkRoot, $InstallDir)) {
  Set-OwnerOnlyAcl -Path $dir -IsFile $false
}

# ---- Step 3: one-time registration ----

Write-Host ""
Write-Host "One-time step: enter the DYO Worker registration code you were given."
Write-Host "It will not be shown on screen, and is removed automatically once this succeeds."
$secureSecret = Read-Host -Prompt "Registration code" -AsSecureString
$registrationSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
)

# Only strip accidental surrounding whitespace - very common after copying
# the code from an email/chat message, and .Trim() catches tabs/other
# whitespace that a naive space-only check would miss. Every other
# character, including punctuation, is preserved exactly - never altered.
$registrationSecret = $registrationSecret.Trim()

if ([string]::IsNullOrWhiteSpace($registrationSecret)) {
  Write-Host "[NEEDS ATTENTION] No registration code was entered. Re-run DYO-Worker-Setup.bat to try again."
  exit 1
}

if ($registrationSecret.Contains('"')) {
  Write-Host "[NEEDS ATTENTION] The registration code you entered contains a double-quote"
  Write-Host "character, which this setup cannot safely store. Please re-check the code you"
  Write-Host "were given (it should not include quote marks) and run DYO-Worker-Setup.bat again."
  exit 1
}

$workerName = $env:COMPUTERNAME
$envPath = Join-Path $InstallDir ".env"
# WORKER_REGISTRATION_SECRET is wrapped in double quotes - Node's --env-file
# parser (used by run-worker.bat and the verification run below) otherwise
# truncates a value at the first unquoted "#" it finds, silently corrupting
# any registration code that happens to contain one - confirmed empirically
# against the real Node 24 --env-file parser, not assumed. Quoting also
# protects any other character that could otherwise look like line syntax
# to a simple parser.
$envLines = @(
  "DYO_API_URL=$ApiUrl"
  "WORKER_NAME=$workerName"
  "AE_MCP_PATH=$AeMcpPath"
  "AE_MCP_INSTANCE_FILE_PATH=$InstanceFilePath"
  "WORK_ROOT=$WorkRoot"
  ('WORKER_REGISTRATION_SECRET="' + $registrationSecret + '"')
)
Set-Content -Path $envPath -Value $envLines -Encoding utf8
Set-OwnerOnlyAcl -Path $envPath -IsFile $true

# ---- Fail-fast validation: never launch the worker against an incomplete
# configuration file. Reads the file back from disk (not the in-memory
# $envLines) specifically so this also catches a write that silently failed
# or was altered on disk, not just a mistake in this script's own logic -
# this is the exact class of failure ("Worker configuration error:
# DYO_API_URL / Required / received: undefined") that reached a real
# client: if it happens again, this now stops with a clear message before
# Node ever runs, instead of a cryptic Zod error from inside the worker
# process after the fact.
$writtenEnvLines = Get-Content -Path $envPath
$missingKeys = New-Object System.Collections.Generic.List[string]
foreach ($key in @("DYO_API_URL", "AE_MCP_PATH", "AE_MCP_INSTANCE_FILE_PATH")) {
  $line = $writtenEnvLines | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
  $value = if ($line) { $line.Substring($key.Length + 1) } else { $null }
  if ([string]::IsNullOrWhiteSpace($value)) {
    $missingKeys.Add($key)
  }
}
if (-not ($writtenEnvLines | Where-Object { $_ -match '^WORKER_REGISTRATION_SECRET=' } | Select-Object -First 1)) {
  $missingKeys.Add("WORKER_REGISTRATION_SECRET")
}

if ($missingKeys.Count -gt 0) {
  Write-Host "[NEEDS ATTENTION] Setup could not write a complete configuration file."
  Write-Host "Missing or empty: $($missingKeys -join ', ')"
  Write-Host "This computer was not registered - no worker was started."
  Write-Host "Please run DYO-Worker-Setup.bat again. If this keeps happening, contact DYO"
  Write-Host "(do not share your registration code with anyone else)."
  exit 1
}
Write-CheckResult $true "Configuration file is complete"

Write-Host ""
Write-Host "Registering this computer with DYO..."

$credentialsPath = Join-Path $WorkRoot "state\worker-credentials.json"
if (Test-Path $credentialsPath) {
  Remove-Item $credentialsPath -Force
}

$regLog = Join-Path $InstallDir "setup-registration.log"
$regErrLog = Join-Path $InstallDir "setup-registration-error.log"

# maxConcurrency is fixed at 1 by the worker itself (apps/worker/src/bootstrap.ts,
# PHASE_2_MAX_CONCURRENCY) - not something this script sets.
$proc = Start-Process -FilePath "node" `
  -ArgumentList "--env-file=.env", "dist\index.js" `
  -WorkingDirectory $InstallDir `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $regLog -RedirectStandardError $regErrLog

$registered = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $credentialsPath) {
    $registered = $true
    break
  }
  if ($proc.HasExited) {
    break
  }
}

# Registration is already durably saved to disk by this point if $registered
# is true (apps/worker writes worker-credentials.json before the heartbeat
# loop starts) - stopping the process here is safe. Windows has no reliable
# way to deliver a graceful stop to another process (only a real console
# Ctrl+C is delivered as a true signal), so this is a deliberate hard stop
# of a verification run, not a shortcut around graceful shutdown.
if ($proc -and -not $proc.HasExited) {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}

if (-not $registered) {
  Write-Host "[NEEDS ATTENTION] Registration did not complete."
  Write-Host ""
  Write-Host "Details (the worker never logs your registration code, so this is safe to share):"
  # Defense-in-depth on top of that guarantee: never show a line that looks
  # like it could contain a secret/token/authorization value, even though
  # the worker itself is not expected to produce one here.
  $suspiciousLinePattern = 'WORKER_REGISTRATION_SECRET|Authorization|Bearer\s|workerToken'
  foreach ($logFile in @($regErrLog, $regLog)) {
    if (Test-Path $logFile) {
      Get-Content -Path $logFile -Tail 15 | ForEach-Object {
        if ($_ -match $suspiciousLinePattern) {
          Write-Host "  [a line was hidden for safety]"
        } else {
          Write-Host "  $_"
        }
      }
    }
  }
  Write-Host ""
  Write-Host "Full details are also saved at: $regErrLog"
  Write-Host "Your registration code was not saved. You can safely run DYO-Worker-Setup.bat again."
  Remove-RegistrationSecretFromEnv -Path $envPath
  exit 1
}

Write-CheckResult $true "Registered with DYO"

# The one-time code is no longer needed: apps/worker/src/bootstrap.ts always
# prefers the persisted credentials file over WORKER_REGISTRATION_SECRET.
Remove-RegistrationSecretFromEnv -Path $envPath
Remove-Item $regLog -ErrorAction SilentlyContinue
Remove-Item $regErrLog -ErrorAction SilentlyContinue

if (Test-Path $credentialsPath) {
  Set-OwnerOnlyAcl -Path $credentialsPath -IsFile $true
}

# ---- Step 4: automatic startup (Windows Scheduled Task) ----
#
# Only reached after $registered is true, i.e. worker-credentials.json
# already exists on disk - this task's action never needs
# WORKER_REGISTRATION_SECRET (it's already been stripped from .env above)
# and never passes WORKER_ID/WORKER_TOKEN as an argument; the worker reads
# the persisted credentials file itself at startup. Nothing secret ever
# appears in the task definition, Task Scheduler's history, or the log file
# below - the worker's own logging already never includes the token/secret,
# and the log is additionally piped through format-status.js, which
# redacts any field named like "token"/"secret" as a second layer.
Write-Host ""
Write-Host "Setting up automatic startup..."

# run-worker.bat (see below) writes its log relative to its own directory
# (InstallDir\logs), so that's where this is pre-created and restricted -
# consistent with the "keep logs in the worker local directory" requirement.
$logsDir = Join-Path $InstallDir "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Set-OwnerOnlyAcl -Path $logsDir -IsFile $false

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Points at run-worker.bat (shipped inside worker-app/, copied into
# InstallDir above) rather than building an inline cmd.exe /c string here -
# a plain .bat file avoids cmd.exe's fragile nested-quote parsing entirely,
# and can be tested by double-clicking it directly. It handles its own
# logging/rotation into InstallDir\logs (it `cd`s to its own directory
# first, so this works regardless of what -WorkingDirectory below resolves to).
$runWorkerBat = Join-Path $InstallDir "run-worker.bat"
if (-not (Test-Path $runWorkerBat)) {
  Write-Host "[NEEDS ATTENTION] run-worker.bat is missing from the installed files."
  Write-Host "Re-download the full DYO Worker setup package and try again."
  exit 1
}
$action = New-ScheduledTaskAction -Execute $runWorkerBat -WorkingDirectory $InstallDir

# AtLogOn for the current user only (not all users on this machine) - an
# "Interactive" logon-type task like this runs using the user's own
# already-established session and never needs their Windows password
# stored anywhere, unlike "run whether user is logged on or not".
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# RestartCount/RestartInterval: if the worker process exits unexpectedly
# (a crash), Task Scheduler retries it roughly every minute - "restart
# safely on worker failure". ExecutionTimeLimit is set to unlimited
# (Task Scheduler's default is to kill a task after 72 hours, which would
# silently stop a long-running background worker). MultipleInstances
# IgnoreNew stops a second automatic run from ever stacking on top of one
# already in progress.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Runs the DYO Video Worker automatically when $env:USERNAME logs into Windows. Installed by DYO-Worker-Setup.ps1 - safe to remove via DYO-Worker-Uninstall.bat." `
  | Out-Null

Write-CheckResult $true "Automatic startup configured (starts at Windows logon)"

Write-Host "Starting DYO Worker now..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "================================================"
Write-Host "  Setup complete"
Write-Host "================================================"
Write-Host "DYO Worker is running in the background and will start automatically"
Write-Host "every time you log into Windows - you do not need to start it manually."
Write-Host ""
$logPath = Join-Path $logsDir "worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
Write-Host "(DYO-Worker-Start.bat is still available if you ever need to run the"
Write-Host "worker manually - for example, for troubleshooting.)"
