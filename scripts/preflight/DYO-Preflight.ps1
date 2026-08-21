<#
.SYNOPSIS
  DYO Video Agent - read-only Windows worker preflight.

.DESCRIPTION
  Collects machine/AE/MCP/dependency/network/power/POC facts needed to plan
  Phase 1+ development. This script is READ-ONLY BY CONTRACT:
    - it must never modify, save, or touch any .aep file
    - it must never install/update software (including ae-mcp)
    - it must never change Windows security, power, or firewall settings
    - it must never change any client file
  Every command below is a query/read. If you add a check, keep it read-only
  or do not add it - scripts/preflight/__tests__/dyo-preflight.test.ts enforces
  this with a static scan for mutating cmdlets.

.PARAMETER ApiUrl
  Contabo API URL to test outbound HTTPS reachability against (matches
  DYO_API_URL in .env.example). Defaults to a placeholder; pass the real
  value once known.

.PARAMETER AeMcpPath
  Expected ae-mcp installation path.

.PARAMETER TemplatesRoot
  Optional folder to search for known POC project files (read-only listing
  and hashing only).

.PARAMETER OutFile
  Report output path.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\DYO-Preflight.ps1
#>

[CmdletBinding()]
param(
  [string]$ApiUrl = "https://your-domain.example",
  [string]$AeMcpPath = "C:\AI-Tools\ae-mcp",
  [string]$TemplatesRoot = "",
  [string]$OutFile = ".\DYO-Preflight-Report.txt"
)

$ErrorActionPreference = "Continue"

$KnownGoodPocNames = @(
  "Working-2026",
  "Production-v01",
  "Color-Type-Test-v01",
  "Tanach-Israeli-Reels-F02-Test-v02"
)
$RejectedPocNames = @(
  "Tanach-Israeli-Vertical-Test-v01"
)

$script:Blockers = New-Object System.Collections.Generic.List[string]

function Invoke-Check {
  <# Runs a read-only check and returns its output, or an error line - never throws. #>
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][scriptblock]$Body
  )
  try {
    & $Body
  } catch {
    $script:Blockers.Add("$Name failed: $($_.Exception.Message)")
    "  (unavailable: $($_.Exception.Message))"
  }
}

function Get-MachineSection {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("MACHINE")

  $lines.Add((Invoke-Check "OS info" {
    $os = Get-CimInstance Win32_OperatingSystem
    "  OS: $($os.Caption) ($($os.Version), build $($os.BuildNumber))"
  }))

  $lines.Add((Invoke-Check "CPU info" {
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    "  CPU: $($cpu.Name) - $($cpu.NumberOfCores) cores / $($cpu.NumberOfLogicalProcessors) threads"
  }))

  $lines.Add((Invoke-Check "RAM info" {
    $ram = Get-CimInstance Win32_ComputerSystem
    $gb = [math]::Round($ram.TotalPhysicalMemory / 1GB, 1)
    "  RAM: $gb GB total"
  }))

  $lines.Add((Invoke-Check "GPU info" {
    $gpus = Get-CimInstance Win32_VideoController
    ($gpus | ForEach-Object { "  GPU: $($_.Name) (driver $($_.DriverVersion))" }) -join "`n"
  }))

  $lines.Add((Invoke-Check "Disk free space" {
    $drives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
    ($drives | ForEach-Object {
      $freeGb = [math]::Round($_.FreeSpace / 1GB, 1)
      $sizeGb = [math]::Round($_.Size / 1GB, 1)
      "  Disk $($_.DeviceID) free: $freeGb GB / $sizeGb GB"
    }) -join "`n"
  }))

  $lines -join "`n"
}

function Get-AfterEffectsSection {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("AFTER EFFECTS")

  $aePath = "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe"
  $aerenderPath = "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\aerender.exe"

  foreach ($pair in @(@{ Label = "AfterFX.exe"; Path = $aePath }, @{ Label = "aerender.exe"; Path = $aerenderPath })) {
    $lines.Add((Invoke-Check $pair.Label {
      if (Test-Path $pair.Path) {
        $ver = (Get-Item $pair.Path).VersionInfo.FileVersion
        "  $($pair.Label): found at $($pair.Path) (version $ver)"
      } else {
        $script:Blockers.Add("$($pair.Label) not found at expected path: $($pair.Path)")
        "  $($pair.Label): NOT FOUND at $($pair.Path)"
      }
    }))
  }

  $lines -join "`n"
}

function Get-McpSection {
  param([string]$Path)
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("MCP")

  $lines.Add((Invoke-Check "ae-mcp path" {
    if (Test-Path $Path) {
      "  ae-mcp path: found at $Path"
    } else {
      $script:Blockers.Add("ae-mcp path not found: $Path")
      "  ae-mcp path: NOT FOUND at $Path"
    }
  }))

  $lines.Add((Invoke-Check "ae-mcp structure (read-only listing, depth 2)" {
    if (Test-Path $Path) {
      $items = Get-ChildItem -Path $Path -Depth 2 -ErrorAction SilentlyContinue |
        Select-Object -First 200
      ($items | ForEach-Object { "  " + $_.FullName.Substring($Path.Length).TrimStart('\') }) -join "`n"
    } else {
      "  (skipped, path not found)"
    }
  }))

  $lines.Add((Invoke-Check "ae-mcp status panel (Window -> ae-mcp-status.jsx)" {
    $statusScript = Get-ChildItem -Path $Path -Filter "ae-mcp-status.jsx" -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($statusScript) {
      "  status panel script found: $($statusScript.FullName)"
    } else {
      "  status panel script (ae-mcp-status.jsx) not found by filename search - open After Effects manually and check Window -> ae-mcp-status.jsx for the [ON] LISTENING state"
    }
  }))

  $lines -join "`n"
}

function Get-DependenciesSection {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("DEPENDENCIES")

  $tools = @(
    @{ Name = "Node.js"; Cmd = "node"; Args = "-v" },
    @{ Name = "npm"; Cmd = "npm"; Args = "-v" },
    @{ Name = "Git"; Cmd = "git"; Args = "--version" },
    @{ Name = "FFmpeg"; Cmd = "ffmpeg"; Args = "-version" },
    @{ Name = "FFprobe"; Cmd = "ffprobe"; Args = "-version" }
  )

  foreach ($tool in $tools) {
    $lines.Add((Invoke-Check $tool.Name {
      $cmdInfo = Get-Command $tool.Cmd -ErrorAction SilentlyContinue
      if (-not $cmdInfo) {
        $script:Blockers.Add("$($tool.Name) not found on PATH")
        "  $($tool.Name): NOT FOUND on PATH"
      } else {
        $output = & $tool.Cmd $tool.Args 2>&1 | Select-Object -First 1
        "  $($tool.Name): $output ($($cmdInfo.Source))"
      }
    }))
  }

  $lines.Add((Invoke-Check "Heebo font" {
    $fontsKey = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
    $matches = Get-ItemProperty -Path $fontsKey -ErrorAction SilentlyContinue |
      Get-Member -MemberType NoteProperty |
      Where-Object { $_.Name -like "*Heebo*" }
    if ($matches) {
      "  Heebo font: installed (" + (($matches | ForEach-Object { $_.Name }) -join ", ") + ")"
    } else {
      "  Heebo font: NOT FOUND in registered fonts"
    }
  }))

  $lines -join "`n"
}

function Get-RunningProcessesSection {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("RUNNING PROCESSES / PORTS")

  $lines.Add((Invoke-Check "Node/AfterFX/aerender processes" {
    $procs = Get-Process -Name "node", "AfterFX", "aerender" -ErrorAction SilentlyContinue
    if ($procs) {
      ($procs | ForEach-Object { "  $($_.ProcessName) (pid $($_.Id))" }) -join "`n"
    } else {
      "  none of node/AfterFX/aerender currently running"
    }
  }))

  $lines.Add((Invoke-Check "Listening Node ports" {
    $nodePids = (Get-Process -Name "node" -ErrorAction SilentlyContinue).Id
    if ($nodePids) {
      $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $nodePids -contains $_.OwningProcess }
      if ($listening) {
        ($listening | ForEach-Object { "  listening: $($_.LocalAddress):$($_.LocalPort) (pid $($_.OwningProcess))" }) -join "`n"
      } else {
        "  node running but no listening ports found"
      }
    } else {
      "  no node process running"
    }
  }))

  $lines -join "`n"
}

function Get-NetworkSection {
  param([string]$TargetUrl)
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("NETWORK")

  $lines.Add((Invoke-Check "Outbound HTTPS to $TargetUrl" {
    $uri = [Uri]$TargetUrl
    $result = Test-NetConnection -ComputerName $uri.Host -Port 443 -WarningAction SilentlyContinue
    if ($result.TcpTestSucceeded) {
      "  outbound HTTPS to $($uri.Host):443 : SUCCEEDED"
    } else {
      $script:Blockers.Add("Outbound HTTPS to $($uri.Host):443 failed")
      "  outbound HTTPS to $($uri.Host):443 : FAILED"
    }
  }))

  $lines -join "`n"
}

function Get-PowerSection {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("POWER")

  $lines.Add((Invoke-Check "Active power plan" {
    $activePlan = powercfg /getactivescheme
    "  $activePlan"
  }))

  $lines.Add((Invoke-Check "Sleep/hibernate timeouts (AC)" {
    $query = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1
    ($query | Select-String "Current AC Power Setting Index") -join "`n" |
      ForEach-Object { "  $_" }
  }))

  $lines -join "`n"
}

function Get-SecuritySection {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("WINDOWS DEFENDER / FIREWALL (observation only)")

  $lines.Add((Invoke-Check "Defender status" {
    $mp = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($mp) {
      "  Defender real-time protection: $($mp.RealTimeProtectionEnabled)"
    } else {
      "  Defender status: unavailable (Get-MpComputerStatus not accessible)"
    }
  }))

  $lines.Add((Invoke-Check "Firewall profiles" {
    $profiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue
    if ($profiles) {
      ($profiles | ForEach-Object { "  $($_.Name): Enabled=$($_.Enabled)" }) -join "`n"
    } else {
      "  firewall profile status: unavailable"
    }
  }))

  $lines -join "`n"
}

function Get-PocSection {
  param([string]$Root, [string[]]$KnownGood, [string[]]$Rejected)
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("POC")

  if (-not $Root -or -not (Test-Path $Root)) {
    $lines.Add("  no TemplatesRoot supplied or path not found - skipping POC file search")
    $lines -join "`n"
    return
  }

  $lines.Add((Invoke-Check "Known-good POC projects" {
    $found = foreach ($name in $KnownGood) {
      $hit = Get-ChildItem -Path $Root -Filter "$name*.aep" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hit) {
        $hash = (Get-FileHash -Path $hit.FullName -Algorithm SHA256).Hash
        "  FOUND $name -> $($hit.FullName) (sha256 $hash)"
      } else {
        "  missing: $name"
      }
    }
    $found -join "`n"
  }))

  $lines.Add((Invoke-Check "Rejected POC projects (must not be used)" {
    $found = foreach ($name in $Rejected) {
      $hit = Get-ChildItem -Path $Root -Filter "$name*.aep" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hit) {
        "  present but REJECTED, do not use: $($hit.FullName)"
      } else {
        "  not present (expected): $name"
      }
    }
    $found -join "`n"
  }))

  $lines -join "`n"
}

# ---- Run all sections (read-only) ----

$sections = New-Object System.Collections.Generic.List[string]
$sections.Add("DYO-Preflight-Report")
$sections.Add("Generated: $(Get-Date -Format o)")
$sections.Add("")
$sections.Add((Get-MachineSection))
$sections.Add("")
$sections.Add((Get-AfterEffectsSection))
$sections.Add("")
$sections.Add((Get-McpSection -Path $AeMcpPath))
$sections.Add("")
$sections.Add((Get-DependenciesSection))
$sections.Add("")
$sections.Add((Get-RunningProcessesSection))
$sections.Add("")
$sections.Add((Get-NetworkSection -TargetUrl $ApiUrl))
$sections.Add("")
$sections.Add((Get-PowerSection))
$sections.Add("")
$sections.Add((Get-SecuritySection))
$sections.Add("")
$sections.Add((Get-PocSection -Root $TemplatesRoot -KnownGood $KnownGoodPocNames -Rejected $RejectedPocNames))
$sections.Add("")

$sections.Add("BLOCKERS")
if ($script:Blockers.Count -eq 0) {
  $sections.Add("  none detected")
} else {
  foreach ($b in $script:Blockers) {
    $sections.Add("  - $b")
  }
}
$sections.Add("")

$ready = if ($script:Blockers.Count -eq 0) { "YES" } else { "NO" }
$sections.Add("READY_FOR_DEVELOPMENT: $ready")

$report = $sections -join "`n"
$report | Out-File -FilePath $OutFile -Encoding utf8
Write-Output $report
Write-Output ""
Write-Output "Report written to: $OutFile"
