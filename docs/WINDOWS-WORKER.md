# DYO Windows Worker

`apps/worker` is the process that runs on the Windows machine with After
Effects installed. It connects outbound to the Contabo API, reports health,
and (in later phases) will execute allowlisted AE/MCP/render operations. It
never accepts inbound connections and never executes arbitrary commands.

## Outbound-only architecture

```
Contabo API
    ^ HTTPS outbound (worker -> API only)
DYO Windows Worker
    v
After Effects / ae-mcp / FFmpeg / aerender
```

- The worker always initiates the connection to the API. The API never
  connects to the worker.
- No inbound Windows port is opened or required.
- No RDP/AnyDesk/remote-desktop dependency exists in this architecture. Those
  tools may be used by a human operator for out-of-band troubleshooting, but
  the worker's normal operation never depends on them.
- No public IP is required on the Windows machine.
- The worker never runs arbitrary shell, PowerShell, or JSX supplied by the
  API. It only recognizes a fixed, versioned allowlist of operation types
  (see "Operation allowlist" below), and Phase 2 does not implement execution
  of any of them yet - only health reporting.

## Prerequisites

- Windows 10/11 with the target After Effects 2026 installation.
- Node.js 24 (matches the rest of this monorepo).
- Network access from the Windows machine to the Contabo API's HTTPS
  endpoint. No inbound firewall rule is needed.
- A `WORK_ROOT` directory the Windows user account can read/write
  (default `C:\DYO-Agent`).

## Environment variables

Set these in a local `.env` (or your process manager's environment config) -
**never commit real values**. See `.env.example` at the repo root for
placeholders.

| Variable | Required | Description |
|---|---|---|
| `DYO_API_URL` | yes | Base URL of the Contabo API, e.g. `https://api.yourdomain.example`. |
| `WORKER_NAME` | yes | Human-readable name used at registration time and in logs. |
| `WORKER_ID` | no | Pre-provisioned worker ID. Set together with `WORKER_TOKEN`, or leave both unset for first-time pairing. |
| `WORKER_TOKEN` | no | Pre-provisioned worker token. Must be set together with `WORKER_ID`. |
| `WORKER_REGISTRATION_SECRET` | only for first pairing | One-time pairing secret, must match the API's own `WORKER_REGISTRATION_SECRET`. Only used when no credentials exist yet (see "Pairing/registration"). |
| `WORK_ROOT` | no | Root directory for all worker-local state and future job workspaces. Defaults to `C:\DYO-Agent` on Windows. |
| `AE_PATH` | no | Path to the After Effects installation (used for read-only health detection). |
| `AERENDER_PATH` | no | Path to `aerender.exe` (used for read-only availability detection). |
| `AE_MCP_PATH` | no | ae-mcp's install directory. The worker's MCP health check and inspection transport both invoke exactly `node <AE_MCP_PATH>/dist/index.js <fixed subcommand>` - confirmed directly against the real upstream HeroicSwan/after-effects-mcp repository's `package.json`/`src/index.ts` (2026-08-24), not assumed (see "Health detection" below). |
| `HEARTBEAT_INTERVAL_MS` | no | Milliseconds between heartbeats when healthy. Defaults to `15000`. |

`WORKER_REGISTRATION_SECRET` is never logged. Neither is `WORKER_TOKEN`, at
any point, in any log line.

## Pairing/registration

The worker resolves its credentials in this order, on every startup:

1. **Pre-provisioned**: `WORKER_ID` and `WORKER_TOKEN` are both set in the
   environment - used directly, no API call.
2. **Persisted from a prior pairing**: a `worker-credentials.json` file under
   `WORK_ROOT\state\` from a previous successful registration - used
   directly, no API call.
3. **First-time pairing**: if neither of the above is available, the worker
   calls `POST /api/workers/register` using `WORKER_REGISTRATION_SECRET` as
   the bearer token. On success, the API issues a unique `workerId` +
   `workerToken`, which the worker persists to `WORK_ROOT\state\
   worker-credentials.json` and uses for every heartbeat from then on. See
   "Credential file protection" below for what actually restricts access to
   that file.

If none of the three are available, the worker fails fast at startup with a
clear configuration error rather than starting in a broken state.

After the first successful pairing, `WORKER_REGISTRATION_SECRET` is no
longer needed for that machine (though it does no harm to leave it set).

### Credential file protection

`worker-credentials.json` is written with POSIX file mode `0o600`
(`apps/worker/src/infrastructure/credential-store.ts`). That gives real
owner-only protection on Linux/macOS, including this repo's own dev/test
environment - but **the worker's actual runtime target is Windows**, and
Node.js does not implement POSIX permission bits there. Setting `mode: 0o600`
on Windows has no meaningful access-control effect.

On Windows, whatever actually protects this file is NTFS ACLs - inherited
from `WORK_ROOT` and its parent directories, or explicitly set by whoever
provisions the machine. This code does not set or verify those ACLs, and
this repository's development environment has no Windows machine to check
that behavior against. Do not assume this file is access-restricted on
Windows until that has been verified on the real Windows worker (e.g. via
`icacls` inspection during the pending Windows preflight/audit) - track this
alongside the ae-mcp integration work that is deferred for the same reason.

## Start/stop

```bash
# from the repo root
npm --workspace @dyo/worker run start   # production
npm --workspace @dyo/worker run dev     # watch mode, local development
```

Stop with `Ctrl+C` (`SIGINT`) or a process manager's stop signal (`SIGTERM`).
Both trigger the same graceful shutdown: the heartbeat loop stops accepting
new ticks, any in-flight heartbeat is allowed to finish, and the process
exits cleanly. No forced kill is required in normal operation.

## Non-technical Windows deployment package

For the actual client machine, `deploy/windows-worker/` is a self-contained,
double-click setup package (`DYO-Worker-Setup.bat`, `DYO-Worker-Start.bat`,
`DYO-Worker-Stop.bat`, `README-FIRST.txt`) - no terminal or npm knowledge
required on the client side. It runs this same worker code, unmodified;
see `deploy/windows-worker/README-FIRST.txt` for the client-facing
instructions and that folder's own script comments for the full design
(one-time registration-secret handling, NTFS ACL restriction, graceful vs.
forced stop on Windows).

The package's `worker-app/` runtime folder is a build artifact - like every
other `dist/` in this repo, it is gitignored and regenerated on demand, never
hand-edited or committed:

```bash
npm run package:windows-worker   # rebuilds worker-app/ from current source
```

Run this before handing the `deploy/windows-worker/` folder to a client, so
it reflects the current worker code.

## Folder structure

```
WORK_ROOT/                       (default C:\DYO-Agent)
  state/
    worker-credentials.json      persisted pairing credentials (never committed, never logged)
  jobs/
    <job-id>/                    one isolated workspace per job (Phase 3+, not created yet)
```

All future file operations are restricted to `WORK_ROOT`. Paths are
normalized and validated before any filesystem access; an absolute path, a
`..` traversal attempt, or a null byte in a path segment is rejected rather
than silently clamped (`apps/worker/src/workspace/work-root.ts`).

## Heartbeat

Every `HEARTBEAT_INTERVAL_MS`, the worker sends an authenticated
`POST /api/workers/:workerId/heartbeat` with:

- `aeStatus`, `mcpStatus` - `ONLINE` / `OFFLINE` / `UNKNOWN`
- `aeVersion` - best-effort, `null` if not determinable
- `capabilities` - only operations this build actually implements
- `maxConcurrency` - fixed at `1` in Phase 2
- `currentJobId` - always `null` in Phase 2 (no job execution yet)

On success, the next heartbeat is scheduled at the normal interval. On
failure (network outage, server error), the worker retries with bounded
exponential backoff (starting at 2s, capped at 60s) - it never enters a
tight retry loop, and it never crashes the process. When the API becomes
reachable again, heartbeats resume automatically at the normal cadence.

## Health detection

All health detection is read-only - it never writes to, modifies, or
launches After Effects.

- **AE status**: if `AE_PATH` is not configured, always `UNKNOWN`. If
  configured, the worker checks whether `AfterFX.exe` is running via a
  single fixed, allowlisted diagnostic command (`tasklist` on Windows, with
  a fixed argument list - never a caller-supplied command). If that check
  cannot run reliably (e.g. non-Windows, `tasklist` unavailable), the result
  is `UNKNOWN` - never fabricated as `ONLINE`/`OFFLINE`.
- **AE version**: best-effort extraction from `AE_PATH`, `null` if nothing
  recognizable is present.
- **aerender availability**: whether `AERENDER_PATH` points at a file that
  exists on disk.
- **MCP status**: real integration against ae-mcp's own official public CLI
  contract (corrected 2026-08-24, replacing an earlier approach that parsed
  ae-mcp's undocumented internal `instance.json` files - see git history
  for that prior design if needed). The worker exposes a clean `McpAdapter`
  interface (`apps/worker/src/health/mcp-adapter.ts`) so implementations
  are swappable without touching any call site; `HeroicSwanMcpAdapter`
  (`apps/worker/src/health/heroic-swan-mcp-adapter.ts`) is the only
  implementation and is always used.
  - **Command** (confirmed directly against the real upstream
    HeroicSwan/after-effects-mcp repository's `package.json` `scripts` and
    `bin` fields, and `src/index.ts` - not assumed): the worker spawns the
    exact fixed, allowlisted command `node <AE_MCP_PATH>/dist/index.js
    health` - never a shell string, never a caller-influenced argument.
  - **Mapping is based ONLY on the documented exit code**, never on
    parsing the command's stdout: upstream's `health` subcommand prints
    several separate human-labeled lines mixed with JSON fragments (`"Data
    dir: ..."`, `"AE running: ..."`, trailing JSON blobs) - not one
    coherent, stable, documented JSON object. Depending on that text would
    repeat the same undocumented-internals mistake in a different place.
    - **exit 0** (bridge connected, health invoked successfully) -> `ONLINE`.
    - **exit 1** (bridge not connected) -> `OFFLINE` - real evidence of
      "not running", not absence of information.
    - **exit 2** (health invocation itself failed), a missing/unreadable
      script, a timeout, or any other/unrecognized outcome -> `UNKNOWN` -
      never fabricated. A missing `dist/index.js` is checked explicitly
      before ever spawning `node`, specifically because Node's own
      "cannot find module" failure also exits 1 - indistinguishable, by
      exit code alone, from ae-mcp's own "bridge not connected" signal
      (found via real spawn-based testing, not assumed).
  - Bounded by a fixed timeout (default 8s, well under the 15s heartbeat
    interval) so an unresponsive bridge can never hang the heartbeat loop.

### Read-only AE inspection transport (INSPECT_TEMPLATE)

`HeroicSwanMcpClient` (`apps/worker/src/inspection/heroic-swan-mcp-client.ts`)
is the transport for calling ae-mcp's real MCP tools, built on the official
`@modelcontextprotocol/sdk` (the same SDK upstream itself depends on) - not
a hand-rolled protocol parser.

- **Command**: spawns the one fixed allowlisted command
  `node <AE_MCP_PATH>/dist/index.js serve` via `StdioClientTransport`, then
  performs the real MCP `initialize` handshake.
- **Allowlist**: the client's public surface only permits calling exactly
  five read-only tools - `ae_health`, `ae_list_instances`,
  `ae_get_project_info`, `ae_list_compositions`, `ae_get_composition` -
  enforced by a TypeScript union type, not just a runtime check. Upstream
  registers many more tools (Blender bridge, transcription, editorial
  planning, workflow audits, and `ae_run_jsx`, which can mutate a live AE
  project) - there is no method on this client to call any of those.
- **Results are returned raw** (`{ ok: true, content: unknown }` or a
  typed `{ ok: false, error }`), deliberately not parsed into a rigid
  schema yet: upstream's exact field-level response shape for these tools
  has not been confirmed against a real sample the way the old
  `instance.json` schema was. Building a `TemplateManifest` from these
  tools' actual output remains a separate follow-up once a real sample
  exists - fabricating that mapping now would repeat the same mistake in
  a new place.

## Operation allowlist

The worker recognizes exactly these operation types
(`apps/worker/src/domain/operation-allowlist.ts`, sourced from
`@dyo/schemas`):

```
CHECK_HEALTH, INSPECT_TEMPLATE, VALIDATE_PLAN, PREPARE_PROJECT,
EXECUTE_FRAME, APPLY_BRANDING, CREATE_PREVIEW, CREATE_HORIZONTAL,
CREATE_REELS, PREPARE_RENDER, RENDER, RESUME_JOB
```

Nothing outside this list is ever valid, and none of these map to arbitrary
shell/PowerShell/JSX execution, an arbitrary executable path, or an arbitrary
filesystem path from API input. Phase 2 implements none of these operations
yet - only `CHECK_HEALTH`-equivalent reporting via the heartbeat. Dispatching
and executing the remaining operations is future work, gated on the real
Windows/ae-mcp audit.

## Troubleshooting

- **Worker exits immediately with a configuration error**: check that
  `DYO_API_URL` and `WORKER_NAME` are set, and that either
  (`WORKER_ID` + `WORKER_TOKEN`) or `WORKER_REGISTRATION_SECRET` is
  available.
- **Registration fails with 401**: `WORKER_REGISTRATION_SECRET` does not
  match the API's configured secret.
- **Heartbeat fails with 401 repeatedly**: the persisted/pre-provisioned
  `WORKER_TOKEN` is no longer valid on the API side (e.g. the worker record
  was removed). Delete `WORK_ROOT\state\worker-credentials.json` and provide
  a fresh `WORKER_REGISTRATION_SECRET` to re-pair.
- **API unreachable**: the worker logs `heartbeat failed, will retry` and
  keeps retrying with bounded backoff. This is expected during a temporary
  API outage; no manual intervention is needed unless the outage is
  prolonged.
- **AE/MCP status always `UNKNOWN`**: expected until `AE_PATH`/`AE_MCP_PATH`
  are configured and point at real, complete installs (see "Health
  detection" above for the specific conditions that produce `UNKNOWN` for
  each).
