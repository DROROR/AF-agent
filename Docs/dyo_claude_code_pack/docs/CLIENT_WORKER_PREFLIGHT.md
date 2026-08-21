# Client Windows Worker — Preflight

## Objective
Verify the existing client machine automatically with minimal client involvement. Do not ask the client to manually check technical details that a script can collect.

## Client-facing interaction
The client should only need to:
1. run one preflight script/tool,
2. send the generated report,
3. open After Effects once and show the existing MCP status panel if automated detection is insufficient,
4. later run/pair the DYO Worker installer.

## Read-only checks
Collect:
- Windows edition/version/build,
- CPU model/cores/threads,
- total RAM,
- GPU model/driver,
- disk free space,
- After Effects 2026 path/version,
- `AfterFX.exe`,
- `aerender.exe`,
- Node/npm/Git versions and paths,
- FFmpeg/FFprobe versions and paths,
- `C:\AI-Tools\ae-mcp` existence and structure,
- running Node/AfterFX/aerender processes,
- listening Node ports,
- Heebo fonts,
- outbound HTTPS connectivity to Contabo,
- current power/sleep settings,
- Windows Defender/firewall observations,
- known POC project paths and hashes if paths are supplied.

## Known environment to inspect
Expected existing path:

```text
C:\AI-Tools\ae-mcp
```

Existing status panel:

```text
Window -> ae-mcp-status.jsx
```

Healthy state previously used:

```text
[ON] LISTENING
```

## Existing POC projects to locate/read only
Valid references:
- Working-2026
- Production-v01
- Color-Type-Test-v01
- Tanach-Israeli-Reels-F02-Test-v02

Do NOT use the rejected vertical test:
- Tanach-Israeli-Vertical-Test-v01.aep

## Preflight output
Generate one human-readable report such as:

```text
DYO-Preflight-Report.txt
```

Sections:

```text
MACHINE
AFTER EFFECTS
MCP
DEPENDENCIES
NETWORK
POWER
POC
BLOCKERS
READY_FOR_DEVELOPMENT: YES/NO
```

## Important
Preflight must not:
- modify/save `.aep` files,
- update ae-mcp,
- install packages,
- change Windows security settings,
- disable firewall/Defender,
- change client files.
