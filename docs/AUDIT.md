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

## Phase 4 status update (2026-08-25) — COMPLETE

Phase 4 ("Real Windows Worker + After Effects / ae-mcp integration") is
**complete**, verified live against the real client machine and the real
production Contabo API/database (not simulated), via direct `psql` queries
against `workers` and a live `curl` against `dyo-api`'s own `/health/ready`:

- Worker `345ee0a4-ef4d-4b87-a923-726f97144aa4` (`DESKTOP-A629N4N`):
  `status: ONLINE`, `aeStatus: ONLINE`, `mcpStatus: ONLINE`,
  `maxConcurrency: 1`.
- 5 consecutive heartbeats observed live over ~70s (10:16:48–10:17:53 UTC),
  each ~15–16s apart matching `HEARTBEAT_INTERVAL_MS`, `lastHeartbeatAt`
  strictly advancing each time, all three status fields stable throughout.
- `createdAt` unchanged since original registration (2026-08-24 15:32:12
  UTC) — confirmed no re-registration, no duplicate worker row (3 total
  rows in `workers`: this one plus the two pre-existing `worker-a`/
  `worker-b` test workers, both `OFFLINE`, untouched).
- `dyo-api` healthy (`GET /health/ready` → `{"status":"ok","database":"ok"}`,
  PM2 uptime 41h, no new restarts) and PostgreSQL reachable.

This closes 4A (Windows preflight - done 2026-08-23), 4B (real worker
deployment - registered and heartbeating live), and 4C (MCP adapter
implementation from verified behavior) - superseding the plan's original
"paused" note below and the `McpInstanceFileAdapter`/`instance.json`
approach it once described: `mcpStatus` is now sourced from
`HeroicSwanMcpAdapter`
(`apps/worker/src/health/heroic-swan-mcp-adapter.ts`), which runs
ae-mcp's own official, upstream-documented `health` CLI command and reads
its real exit code - confirmed directly against the real client's ae-mcp
bridge, not fabricated. 4D (an interrupted-job recovery test) and 4E (a
dedicated Windows security validation pass) were **not** part of this
verification and remain open if still required - no job has been
dispatched to this worker yet (the `jobs` table for it is empty), and no
separate formal security-validation pass has been recorded beyond the
NTFS-ACL/no-stored-password/redacted-logging measures already built into
`DYO-Worker-Setup.ps1`/`DYO-Worker-Repair.ps1` and `apps/worker` itself.

## READY_FOR_DEVELOPMENT (Phase 4 real-machine work): READY — the client Windows worker is connected, registered, and reporting real (non-fabricated) `aeStatus`/`mcpStatus`. `https://worker-api.dyocourses.com` is live with a valid TLS certificate, path-allowlisted to only the routes the worker calls.

## Overall project status (2026-08-22)

For anyone picking this up cold, the state of each phase:

- **Phase 0** (repo/tooling foundation, read-only Windows preflight tool):
  complete — see above. Commit `chore: establish engineering foundation and
  Windows preflight`.
- **Phase 1** (Contabo control-plane foundation — Fastify API, PostgreSQL,
  Drizzle, worker registry/heartbeat): complete. Commit `feat(api): add
  Contabo control-plane foundation (worker registry, heartbeat, health)`.
- **Phase 1.5** (real production verification on the actual Contabo server —
  native PostgreSQL, PM2, health/registration/heartbeat/persistence all
  verified against the real running API): complete. Commit `chore(deploy):
  verify native Contabo API and PostgreSQL runtime`.
- **Phase 2** (real DYO Windows Worker — registration/pairing, authenticated
  heartbeat, health detection, bounded backoff, path-traversal-safe
  workspace): complete. See `docs/WINDOWS-WORKER.md`. Commit `feat(worker):
  add secure outbound Windows worker foundation`.
- **Phase 3** (read-only DYO operations dashboard — Next.js, real API
  integration, PM2-deployed): complete. Commit `feat(web): add DYO
  operations dashboard`.
- **Phase 4** (real Windows Worker + After Effects/ae-mcp integration):
  **complete** (verified 2026-08-25 - see "Phase 4 status update
  (2026-08-25) — COMPLETE" above). Resumed 2026-08-23. Client machine confirmed: Windows 11 Pro,
  After Effects 2026 v26.3, `aerender.exe` present, Node 24.15.0, npm
  11.12.1, Git installed, ae-mcp installed at `C:\AI-Tools\ae-mcp` with its
  status panel showing `[ON] LISTENING / CONNECTED`, Heebo fonts installed.
  FFmpeg/FFprobe still missing on the client machine (not a blocker for
  worker registration/heartbeat/health - see `docs/WINDOWS-WORKER.md`).
  Element 3D confirmation still pending from the client.
  - Fixed a real false-blocker bug in `scripts/preflight/DYO-Preflight.ps1`:
    the unconfigured `-ApiUrl` placeholder (`https://your-domain.example`)
    was being tested for real outbound HTTPS reachability and always
    failing, incorrectly forcing `READY_FOR_DEVELOPMENT: NO`. It now
    reports `SKIPPED - API endpoint not configured` and adds no blocker
    until a real endpoint is supplied.
  - Server-side read-only audit: `dyo-api` confirmed still bound to
    `127.0.0.1:4000` (loopback-only); no existing Nginx site proxies to it;
    7 existing `dyocourses.com` sites and their PM2/Nginx/certbot state left
    untouched.
  - Decision: `worker-api.dyocourses.com` is the dedicated hostname for the
    DYO Windows Worker API. DNS confirmed live at the authoritative
    nameservers (`ns59`/`ns60.domaincontrol.com`) and at Cloudflare's
    `1.1.1.1`, resolving to this server's real public IP — Google's
    `8.8.8.8` briefly showed a stale negative-cache entry (SOA negative TTL
    600s), a caching artifact, not a misconfiguration.
  - `worker-api.dyocourses.com` is **live**: deployed via a temporary
    HTTP-only bootstrap block, `certbot --nginx -d worker-api.dyocourses.com`
    (real cert, expires 2026-11-21), then the final config from
    `deploy/nginx/worker-api.dyocourses.com.conf` installed over it and
    reloaded. It path-allowlists only `POST /api/workers/register` and
    `POST /api/workers/:workerId/heartbeat` - the only two endpoints the
    Windows worker itself ever calls - and returns 404 for everything else,
    including `GET /api/workers` and `GET /api/workers/:workerId`, which
    have **no authentication at the application layer** and are
    deliberately excluded from this hostname rather than made
    internet-reachable (see the file's own header comment). Verified live:
    TLS valid, both `GET` routes and `/health/*` return 404 externally,
    registration/heartbeat reject invalid credentials with 401, port 4000
    remains loopback-only, all other Nginx sites and PM2 apps untouched.
  - The real client `instance.json` sample was supplied and its schema
    implemented in `McpInstanceFileAdapter`
    (`apps/worker/src/health/mcp-instance-file-adapter.ts`, commit
    `feat(worker): prepare real Windows AE MCP integration`):
    `instanceId`/`aeVersion`/`projectName` (string), `projectPath` (string
    or null), `lastSeen` (ISO timestamp), `pollMs` (positive number),
    `protocolVersion` (integer, currently only `1` recognized), `listening`
    (boolean). ONLINE requires a recognized `protocolVersion`, `listening
    === true`, and a fresh `lastSeen` (`staleAfterMs = max(pollMs * 5,
    10000)`); OFFLINE covers `listening === false` or a stale `lastSeen`;
    everything else (missing file, malformed JSON, schema-invalid,
    unparseable timestamp, unrecognized protocol version) is UNKNOWN, never
    fabricated. Configured via `AE_MCP_INSTANCE_FILE_PATH`; unset by
    default, so existing worker behavior is unchanged until it's explicitly
    set.
  - **Update (2026-08-25):** the real Windows worker is now registered and
    connected against `worker-api.dyocourses.com`, reporting live, real
    `aeStatus`/`mcpStatus` - see "Phase 4 status update (2026-08-25) —
    COMPLETE" above. The `McpInstanceFileAdapter`/`instance.json`-based MCP
    detection described just above was superseded by `HeroicSwanMcpAdapter`
    (ae-mcp's own official `health` CLI command) before this connection was
    verified - `AE_MCP_INSTANCE_FILE_PATH` no longer exists. No
    AE/MCP-inspection automation (INSPECT_TEMPLATE or any other tool call)
    has been run against the client machine yet - only health/heartbeat.
- **Shotstack renderer POC** (a separate, bounded, isolated track pursued
  while Phase 4 was paused, not a phase in the original plan): **complete**.
  Three stages: (1) an initial bounded provider-abstraction + Shotstack POC
  (`docs/RENDERER-ARCHITECTURE.md`, `docs/SHOTSTACK-POC.md`), (2) a live
  sandbox Hebrew+Heebo typography smoke test (PASS), (3) a full real-client
  reference-video fidelity recreation (`docs/SHOTSTACK-REFERENCE-POC.md`),
  using real Cognetica assets. **Final decision: After Effects remains the
  primary, supported production renderer. Shotstack remains an optional
  secondary renderer for simpler 2D videos only** — it has no 3D capability
  at all, and this template's core visual identity (a true Element-3D phone
  mockup) cannot be reproduced by it. This decision is final; the renderer
  abstraction in `packages/renderer` is not being expanded further.
