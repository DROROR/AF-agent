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
  Where ae-mcp's per-instance state file lives. Defaults to a path under the
  CURRENT Windows user's own profile ($env:USERPROFILE) - never inferred
  from the machine hostname, which has no reliable relationship to the
  Windows username.

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
  # Under the CURRENT Windows user's profile - a real client's username is
  # not "PC" (that was a placeholder that shipped as a literal default and
  # never matched any real machine). $env:USERPROFILE resolves to whichever
  # account actually runs this script, which is exactly the account ae-mcp
  # itself runs under and writes its instance file as. Deliberately not
  # derived from $env:COMPUTERNAME/hostname - Windows has no rule tying a
  # machine's hostname to any account's username, so that would be just as
  # wrong as the old hardcoded default, only less obviously so.
  [string]$InstanceFilePath = (Join-Path $env:USERPROFILE "ae-mcp\instances\default\instance.json"),
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

function Write-Utf8NoBomFile {
  <#
    Writes lines as UTF-8 WITHOUT a byte-order mark, using .NET directly.

    A real client hit "Worker configuration error: DYO_API_URL / Required /
    received: undefined" from Node, immediately after this script itself
    reported "[OK] Configuration file is complete". Root cause, confirmed
    empirically: `Set-Content -Encoding utf8` writes UTF-8 WITH a BOM on
    Windows PowerShell 5.1 (the default PowerShell on most Windows machines
    unless PowerShell 7+ was explicitly installed - there is no
    `-Encoding utf8NoBOM` option in 5.1, only in 7+). PowerShell's own
    Get-Content is BOM-transparent and silently strips it when reading -
    which is exactly why this script's own earlier file-completeness check
    passed - but Node's `--env-file` parser is NOT BOM-aware: the BOM
    becomes part of the first key it parses, corrupting only the first
    variable declared in the file (DYO_API_URL, since it's listed first)
    while every later variable loads fine. This uses
    System.Text.UTF8Encoding($false) directly, which behaves identically on
    PowerShell 5.1 and 7+, avoiding the version-dependent flag entirely.
  #>
  param([string]$Path, [string[]]$Lines)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($Path, $Lines, $utf8NoBom)
}

function Remove-RegistrationSecretFromEnv {
  <#
    Strips the WORKER_REGISTRATION_SECRET line from a .env file - the code
    is only ever needed once. Deliberately reads the full file into a
    variable FIRST, then writes, as two separate statements - never a
    single `Get-Content $path | ... | Set-Content $path` pipeline against
    the same file, which is a well-known PowerShell anti-pattern that can
    truncate the file if Set-Content begins writing before Get-Content has
    finished streaming from it. Writes back via Write-Utf8NoBomFile, not
    Set-Content, so this rewrite cannot reintroduce a BOM either. This
    function exists once so both call sites (registration failure and
    registration success) get the same safe behavior instead of
    duplicating the pattern.
  #>
  param([string]$Path)
  $remainingLines = Get-Content -Path $Path | Where-Object { $_ -notmatch '^WORKER_REGISTRATION_SECRET=' }
  Write-Utf8NoBomFile -Path $Path -Lines $remainingLines
}

function Test-WorkerEnvReadableByNode {
  <#
    The only trustworthy way to know whether the real worker will see its
    configuration: ask Node, via the exact `node --env-file=.env` mechanism
    the worker itself uses - not PowerShell's Get-Content, which silently
    disagrees with Node about a leading BOM (see Write-Utf8NoBomFile).
    Never prints values - dist\validate-env.js only ever prints key names.
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
  # The exact path this script already confirmed AfterFX.exe exists at
  # during Step 1's preflight above ($aeExePath) - never a separately
  # hardcoded value. Previously this was never written to .env at all, so
  # the worker's own AE_PATH env var was always undefined and aeStatus
  # always reported UNKNOWN regardless of whether After Effects was
  # actually running (apps/worker/src/health/ae-health.ts's
  # `if (!config.aePath) return UNKNOWN` branch fired unconditionally).
  "AE_PATH=$aeExePath"
  "AE_MCP_PATH=$AeMcpPath"
  "AE_MCP_INSTANCE_FILE_PATH=$InstanceFilePath"
  "WORK_ROOT=$WorkRoot"
  ('WORKER_REGISTRATION_SECRET="' + $registrationSecret + '"')
)
Write-Utf8NoBomFile -Path $envPath -Lines $envLines
Set-OwnerOnlyAcl -Path $envPath -IsFile $true

# ---- Fail-fast validation, part 1 (fast, PowerShell-side): never launch
# the worker against an obviously incomplete configuration file. Reads the
# file back from disk (not the in-memory $envLines) specifically so this
# also catches a write that silently failed or was altered on disk, not
# just a mistake in this script's own logic. Note this check alone is NOT
# sufficient - Get-Content is BOM-transparent (silently strips a leading
# UTF-8 byte-order mark), so it can report a file "complete" even when Node
# cannot read its first variable at all (see Write-Utf8NoBomFile above and
# Test-WorkerEnvReadableByNode below, which is the actual authoritative
# check because it runs the real `node --env-file=.env` mechanism the
# worker itself uses). Kept here only as a fast, cheap first check.
$writtenEnvLines = Get-Content -Path $envPath
$missingKeys = New-Object System.Collections.Generic.List[string]
foreach ($key in @("DYO_API_URL", "AE_PATH", "AE_MCP_PATH", "AE_MCP_INSTANCE_FILE_PATH")) {
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

# ---- Fail-fast validation, part 2 (authoritative, Node-side): proves what
# the real worker process will see by actually running
# `node --env-file=.env` against the file, exactly as the registration
# launch below and every later worker start do. This is the check that
# would have caught the real client failure - the PowerShell-side check
# above passed on that machine even though Node could not read
# DYO_API_URL, because the file carried a UTF-8 BOM that Get-Content
# silently strips but Node's --env-file parser does not.
$preRegistrationCheck = Test-WorkerEnvReadableByNode -InstallDir $InstallDir -RequiredKeys @(
  "DYO_API_URL", "AE_PATH", "AE_MCP_PATH", "AE_MCP_INSTANCE_FILE_PATH", "WORKER_REGISTRATION_SECRET"
)
if (-not $preRegistrationCheck.Ok) {
  Write-Host "[NEEDS ATTENTION] Node cannot read the configuration file this setup just wrote,"
  Write-Host "even though it looks complete. This computer was not registered - no worker was"
  Write-Host "started. Please run DYO-Worker-Setup.bat again. If this keeps happening, contact"
  Write-Host "DYO (do not share your registration code with anyone else)."
  exit 1
}
Write-CheckResult $true "Configuration file is readable by Node"

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

# Confirm the secret-removal rewrite above didn't reintroduce the BOM bug
# and that DYO_API_URL (and the other still-required values) remain
# readable by Node after this second write to the same file.
# WORKER_REGISTRATION_SECRET is intentionally excluded here - it was just
# deliberately stripped and is expected to be absent from this point on.
$postRegistrationCheck = Test-WorkerEnvReadableByNode -InstallDir $InstallDir -RequiredKeys @(
  "DYO_API_URL", "AE_PATH", "AE_MCP_PATH", "AE_MCP_INSTANCE_FILE_PATH"
)
if (-not $postRegistrationCheck.Ok) {
  Write-Host "[NEEDS ATTENTION] Registration succeeded, but the configuration file is no longer"
  Write-Host "readable by Node after cleanup. Please run DYO-Worker-Setup.bat again. If this"
  Write-Host "keeps happening, contact DYO."
  exit 1
}
Write-CheckResult $true "Configuration file remains readable by Node after cleanup"

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
