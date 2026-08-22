# Phase 0 Audit

Status date: 2026-08-21.

## Scope actually completed in this environment

This work was done in a Linux development sandbox with no network path to the
client's Windows PC, no access to `C:\AI-Tools\ae-mcp`, no After Effects
installation, and no existing `.aep` POC files. Everything below reflects
what could genuinely be built and verified here.

### 1. Repository foundation
- Moved the delivered documentation pack into the locations `CLAUDE.md` and
  `docs/engineering/*.md` expect: root `CLAUDE.md`, root `ENGINEERING.md`,
  root `.env.example`, `docs/*.md` (7 files), `docs/engineering/*.md`
  (12 files), `docs/README_START_HERE.md`. Done via `git mv`, so history is
  preserved and the move is reversible.
- `Docs/` now holds only the two original archival `.docx` briefs (confirmed
  byte-identical, MD5 `47144aa4610c83b7c00d408d0de8cffb`) — the delivered
  source material, not duplicated content.
- Removed three stray, git-tracked `.DS_Store` files and the now-empty pack
  directories left behind after the docs were moved into place.
- npm workspace root: `package.json` (`workspaces: apps/*, packages/*`),
  `tsconfig.base.json` (strict mode per `docs/engineering/TYPESCRIPT.md`:
  `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`,
  `useUnknownInCatchVariables`), `tsconfig.json`, `eslint.config.js`
  (flat config, `@typescript-eslint`, `no-explicit-any: error`),
  `.prettierrc`, `.gitignore`, `vitest.config.ts`.
- Did **not** create `apps/`, `packages/`, or `ae/` — those belong to Phase 1+
  and stubbing them now would be scaffolding with no behavior behind it.

### 2. Read-only Windows preflight tool
- `scripts/preflight/DYO-Preflight.ps1` — collects and reports on:
  MACHINE (OS, CPU, RAM, GPU, disk), AFTER EFFECTS (`AfterFX.exe` /
  `aerender.exe` presence + version), MCP (`ae-mcp` path + read-only
  directory listing + status-panel script lookup), DEPENDENCIES (Node, npm,
  Git, FFmpeg, FFprobe versions/paths, Heebo font registration), running
  node/AfterFX/aerender processes and listening Node ports, NETWORK (outbound
  HTTPS reachability to the configured API URL), POWER (active plan, sleep
  timeout — read-only `powercfg` queries), Defender/firewall status
  (observation only), and POC (hashes known-good project names, flags the
  rejected `Tanach-Israeli-Vertical-Test-v01` if present). Writes
  `DYO-Preflight-Report.txt` with a `BLOCKERS` list and a final
  `READY_FOR_DEVELOPMENT: YES/NO` line.
- Every check is a `Get-*`/`Test-*`/query cmdlet. No `.aep` file is opened for
  write, no package is installed, no Windows setting is changed. This is
  enforced by `scripts/preflight/__tests__/dyo-preflight.test.ts`, which
  statically scans the script for mutating cmdlets (`Set-*`, `Remove-*`,
  `Install-*`, `Stop-Service`, etc.) and fails if one appears — not just a
  comment promising read-only behavior.
- `scripts/preflight/DYO-Preflight.bat` — thin launcher, forwards all
  arguments to the `.ps1`.

### 3. Checks run (all green)
```
npm run lint       -> pass (0 problems)
npm run typecheck  -> pass (tsc --noEmit, 0 errors)
npm test           -> pass (6/6 tests, dyo-preflight.test.ts)
npm run build      -> pass (no-op: no buildable app exists yet, by design)
```

## What could NOT be done — hard blocker

**The actual `ae-mcp` audit and POC inspection Phase 0 asks for require
physical or remote access to the client's Windows PC. That access does not
exist in this environment.** Concretely, unable to determine from here:
- how the existing `ae-mcp` at `C:\AI-Tools\ae-mcp` actually starts, what
  bridge/transport it uses, its heartbeat mechanism, or its reconnect
  behavior,
- whether `ae-mcp-status.jsx` exists and shows `[ON] LISTENING`,
- which of the four known-good POC projects (`Working-2026`,
  `Production-v01`, `Color-Type-Test-v01`,
  `Tanach-Israeli-Reels-F02-Test-v02`) are actually present, their real file
  hashes, or their internal structure,
- real Windows/AE/Node/FFmpeg versions and paths on the target machine,
- whether the rejected `Tanach-Israeli-Vertical-Test-v01.aep` is present and
  needs to be explicitly excluded from any later scan.

**To unblock:** the client (or someone with access to that Windows PC) needs
to run `scripts/preflight/DYO-Preflight.ps1` (or the `.bat` launcher) and
share the resulting `DYO-Preflight-Report.txt`, plus confirm the ae-mcp
start/communication mechanism by opening the existing status panel in After
Effects. Until that report comes back, "reusable tools/scripts and gaps" in
the existing `ae-mcp` cannot be honestly assessed — nothing here should be
read as having audited that installation.

## Secondary gaps (not blocking, noted for later)
- Dev sandbox runs Node v22.23.2; the locked stack specifies Node.js 24. Not
  fixed now since it doesn't affect tooling correctness, but the Windows
  worker should be provisioned with Node 24 per `CLAUDE.md`.
- `npm audit` reports esbuild/vite advisories transitively pulled in by
  `vitest@2.x`'s dev-server dependency chain. These affect a local dev server
  we never run (tests use `vitest run`, not `vitest dev`/`--ui`), so treated
  as accepted for now; worth revisiting when Phase 1 adds real app packages
  and a `vitest@3`/`4` upgrade is due anyway.

## Files changed this phase
Moved (`git mv`, listed as renames):
`CLAUDE.md`, `ENGINEERING.md`, `.env.example`, `docs/README_START_HERE.md`,
`docs/ACCEPTANCE.md`, `docs/ARCHITECTURE.md`, `docs/CLIENT_WORKER_PREFLIGHT.md`,
`docs/MASTER_PLAN.md`, `docs/PHASES.md`, `docs/RUNBOOK.md`, `docs/SCHEMAS.md`,
`docs/engineering/API_STANDARDS.md`, `docs/engineering/ARCHITECTURE_RULES.md`,
`docs/engineering/CLAUDE_IMPLEMENTATION_RULES.md`,
`docs/engineering/CODE_STANDARDS.md`, `docs/engineering/DATABASE.md`,
`docs/engineering/DEFINITION_OF_DONE.md`, `docs/engineering/ERROR_HANDLING.md`,
`docs/engineering/FRONTEND.md`, `docs/engineering/GIT_AND_REVIEW.md`,
`docs/engineering/OBSERVABILITY.md`, `docs/engineering/PHASE_GATE_CHECKLIST.md`,
`docs/engineering/SECURITY.md`, `docs/engineering/TESTING.md`,
`docs/engineering/TYPESCRIPT.md`.

Removed: `.DS_Store`, `Docs/.DS_Store`, `Docs/dyo_claude_code_pack/.DS_Store`,
and the emptied `Docs/dyo_claude_code_pack/` and
`Docs/DYO_Engineering_Code_Standards_Pack/` directories.

Created: `package.json`, `tsconfig.base.json`, `tsconfig.json`,
`eslint.config.js`, `.prettierrc`, `.gitignore`, `vitest.config.ts`,
`scripts/preflight/DYO-Preflight.ps1`, `scripts/preflight/DYO-Preflight.bat`,
`scripts/preflight/__tests__/dyo-preflight.test.ts`, this file
(`docs/AUDIT.md`).

No `.aep` file exists in this environment, so none was touched. No ae-mcp
installation exists here, so none was modified.

## READY_FOR_DEVELOPMENT (Phase 0 tooling): YES
## READY_FOR_DEVELOPMENT (real ae-mcp/POC audit): BLOCKED — pending client-run preflight report

## Phase 4 status update (2026-08-22)

Phase 4 ("Real Windows Worker + After Effects / ae-mcp integration") was
started and immediately hit the same hard blocker documented above: it
requires running `scripts/preflight/DYO-Preflight.bat` on the real client
Windows/After Effects machine, and that machine is temporarily unavailable.

Per explicit instruction, Phase 4 is **paused at the real-machine preflight
gate** rather than continued with guessed/fabricated findings. Nothing in
Phase 4A (Windows preflight), 4B (real worker deployment), 4C (MCP adapter
implementation from verified behavior), 4D (recovery tests), or 4E (Windows
security validation) has been performed or documented as complete — all of
it genuinely requires the real machine. `apps/worker`'s `NotIntegratedMcpAdapter`
(Phase 2) remains the honest current state: MCP status is always `UNKNOWN`,
which is correct until real ae-mcp behavior can be observed.

**To resume Phase 4:** run the preflight tool on the real Windows machine and
share `DYO-Preflight-Report.txt` (plus an `ae-mcp-status.jsx` panel
observation if the report's MCP section is inconclusive). Nothing here should
be read as having audited real Windows/AE/ae-mcp behavior.

While Phase 4 was paused, a separate bounded, isolated Shotstack renderer POC
was carried out instead — see `docs/RENDERER-ARCHITECTURE.md` and
`docs/SHOTSTACK-POC.md`. It does not touch `apps/worker`, does not replace or
modify any Windows Worker/ae-mcp code, and does not affect this blocker.

## READY_FOR_DEVELOPMENT (Phase 4 real-machine work): BLOCKED — paused, same reason as above
