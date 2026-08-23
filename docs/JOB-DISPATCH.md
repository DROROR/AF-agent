# Job Dispatch (Phase 5 preparation)

Status: **transport built and tested, no real job has ever been dispatched
to a real machine.** This document exists so `INSPECT_TEMPLATE` (and later
operations) can be dispatched the moment the real Windows worker is online
and `docs/TEMPLATE-INSPECTOR.md`'s remaining blocker (a confirmed ae-mcp
bridge protocol) is resolved.

## Model: the worker pulls, the API never pushes

```
Windows Worker                          Contabo API
      |  POST /heartbeat          --->        |
      |  POST /jobs/claim         --->        |   (worker asks for its own next job)
      |  <---  { job } or { job: null }        |
      |  POST /jobs/:id/report RUNNING  --->   |
      |  ... executes the operation ...        |
      |  POST /jobs/:id/report SUCCEEDED/FAILED --->
```

No new inbound port, no WebSocket. The client Windows worker continues
making outbound HTTPS requests only, over the same authenticated channel as
heartbeat (`worker-api.dyocourses.com`, already deployed - see
`docs/WINDOWS-WORKER.md`). Job claiming/execution/reporting is triggered
once per successful heartbeat tick (`apps/worker/src/index.ts`), not a
separate polling loop - job attempts are naturally paced by
`HEARTBEAT_INTERVAL_MS`, so there is no blind/tight retry.

## Contracts (`packages/schemas`)

- `job.ts` - `JobStatus` (`QUEUED → CLAIMED → RUNNING → {WAITING_FOR_ACTION,
  SUCCEEDED, FAILED, CANCELLED}`), the explicit `JOB_STATUS_TRANSITIONS`
  table (the only transitions ever applied), `JobDto`, `ClaimJobResponse`,
  `ReportJobStatusRequest`.
- `job-payload.ts` - per-operation payload schema registry. `operation`
  always reuses `workerCapabilitySchema` (the existing `WORKER_CAPABILITIES`
  allowlist from Phase 2) - **never an arbitrary command string.** Only
  `INSPECT_TEMPLATE` has a registered payload schema today; every other
  `WORKER_CAPABILITIES` entry is a recognized operation *name* with no
  payload contract or execution handler yet.

## Database (`packages/database`, migration `0001_solid_tempest.sql`)

A `jobs` table, one row per job, always assigned to exactly one worker at
creation (`worker_id NOT NULL`, `ON DELETE CASCADE`) - not a shared queue
any worker can grab. `workers.current_job_id` now has the real foreign key
to `jobs.id` that was left as a known gap since Phase 1
(`ON DELETE SET NULL`). `operation`/`status` are CHECK-constrained to the
same allowlists as the application layer (`docs/engineering/DATABASE.md`:
"prefer DB constraints plus application checks") - `schema.test.ts` guards
that the re-declared literal arrays never drift from `@dyo/schemas`.

## Claiming is atomic and concurrency-limit-aware

`DrizzleJobRepository.claimNextForWorker` (`apps/api/src/infrastructure/db/`)
runs inside one transaction:

1. `SELECT ... FOR UPDATE` on the worker's own row - serializes concurrent
   claim attempts for the *same* worker (without this, two racing claims
   could both read "0 active jobs" before either commits and both succeed,
   over-claiming past `maxConcurrency`).
2. Count the worker's non-terminal (`CLAIMED`/`RUNNING`/`WAITING_FOR_ACTION`)
   jobs; refuse if already at `maxConcurrency`.
3. `SELECT ... FOR UPDATE SKIP LOCKED` the oldest `QUEUED` job for that
   worker - guarantees two different workers, or a retried request, can
   never claim the same row.
4. `UPDATE ... SET status = 'CLAIMED'`.

Verified against a real embedded Postgres (PGlite, the same engine
`workers.integration.test.ts` already uses), not just an in-memory fake -
see `apps/api/src/__integration__/jobs.integration.test.ts`.

## Status reporting is compare-and-swap

`reportJobStatus` re-validates the requested transition against the job's
*actual* current status (never trusts the request), then writes with
`WHERE status = <the status just read>` - so a job that raced against a
concurrent report, or already completed, is rejected (`409 CONFLICT`)
rather than silently double-processed or overwritten.

## Security

Every job endpoint requires the worker's own bearer token, the same
authenticated channel as heartbeat - see `apps/api/src/routes/jobs.ts`. A
worker can only ever see/claim/update jobs whose `worker_id` is its own:
"not found" and "belongs to someone else" return the identical
`404 JOB_NOT_FOUND` (a worker can never probe for another worker's job IDs
by observing a different error, mirroring the existing worker-lookup
pattern in `apps/api/src/application/worker/record-heartbeat.ts`). There is
no shell command field, no PowerShell field, no JSX field, no
user-supplied executable path anywhere in the payload contract - `payload`
is `unknown` at the generic layer specifically so it can never be a raw
string interpreted as a command; it is validated against the operation's
own fixed schema at both the API boundary (`create-job.ts`) and the worker
boundary (`job-dispatcher.ts`) independently.

## Failure / recovery

| Scenario | Behavior |
|---|---|
| Worker offline before claim | Nothing to claim - the job stays `QUEUED`. |
| Worker offline while `CLAIMED`/`RUNNING`/`WAITING_FOR_ACTION` | `sweepStaleJobs` (called lazily before every claim, mirroring `sweepStaleWorkers`) fails it with a typed `WORKER_OFFLINE` error once the worker's heartbeat goes stale - never left stuck forever, never blindly retried. |
| Duplicate polling | The atomic claim transaction above - a second poll simply gets `job: null`. |
| API restart | All state lives in Postgres, not in-process - proven by `jobs.integration.test.ts`'s restart-safe-persistence test (a fresh repository instance against the same DB connection reads the real persisted row). |
| Worker restart | Same - the worker's next heartbeat/claim cycle picks up from whatever the database says, never from in-memory state that no longer exists. |
| Malformed result | `ReportJobStatusRequest` is Zod-validated at the route before it reaches the application layer - a malformed body never reaches the database. |
| Unsupported operation | `job-dispatcher.ts`'s `executeJob` fails safely with `UNSUPPORTED_OPERATION` for any operation with no execution handler, rather than attempting it. |
| Job already completed | Rejected by the compare-and-swap update above (`409 CONFLICT`) - terminal statuses accept no further transition (`JOB_STATUS_TRANSITIONS`). |

## INSPECT_TEMPLATE integration boundary

`apps/worker/src/domain/job-dispatcher.ts` wires `INSPECT_TEMPLATE` to
`NotAvailableTemplateInspector` (`apps/worker/src/inspection/template-inspector.ts`,
built in the prior Phase 5 preparation step). A dispatched `INSPECT_TEMPLATE`
job today will claim successfully, report `RUNNING`, then fail safely with a
typed `NOT_AVAILABLE` result - not a crash, not a fabricated manifest. See
`docs/TEMPLATE-INSPECTOR.md` for exactly what's still needed (a confirmed
ae-mcp bridge protocol) before that stub can be replaced with a real
implementation - nothing about that boundary changed in this phase; this
phase only made it *reachable* via a real job rather than only callable
directly in tests.

## What still requires the real Windows PC

Everything above has been verified against a real embedded Postgres and
real Fastify HTTP round-trips (`apps/api/src/__integration__/jobs.integration.test.ts`),
but never against the actual Windows worker process, and never with a real
job actually reaching `NOT_AVAILABLE` over a live connection. Once the
worker is online (Phase 4's pending real connection):

1. Confirm a real claim/report cycle completes end-to-end against the live
   API (`worker-api.dyocourses.com`), the same way the PGlite integration
   test proves it locally.
2. Confirm the worker's heartbeat-triggered job cycle (`apps/worker/src/index.ts`)
   behaves correctly under real network latency/timeouts, not just the
   synchronous in-memory fakes used in `job-cycle.test.ts`.
3. Only then does `docs/TEMPLATE-INSPECTOR.md`'s own checklist (worker
   ONLINE → AE ONLINE → MCP ONLINE → copy of an approved test project →
   `INSPECT_TEMPLATE` only → compare manifest → no mutation → human
   approval) become the next real step - still blocked on the ae-mcp bridge
   protocol regardless.
