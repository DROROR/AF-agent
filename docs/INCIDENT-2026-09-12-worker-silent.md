# Incident — FAHADNAKASH went silent while still running (2026-09-12)

Status: **root cause fixed in code; fix not yet installed on the worker.**

## What the operator saw

The dashboard showed FAHADNAKASH Offline with AE/MCP Unavailable moments after
an inspection was dispatched. `worker.log` appeared to show the worker running
normally, which led to the reasonable conclusion that it had not crashed.

## What actually happened

| Time (UTC) | Event | Source |
|---|---|---|
| 14:17:48.948 | Job `48bf41d3` INSPECT_TEMPLATE created | `jobs.created_at` |
| 14:17:50 | Job claimed | worker.log |
| 14:17:51.191 | `ae_health` returns `projectOpen: true, projectName: "Untitled", projectPath: null, numItems: 46` | job result `toolCalls[0]` |
| 14:18:23.280 | `app.open()` fails: `[AE_TIMEOUT] Timed out after 30000ms (method: system.runJsx)` | job result `projectOpenEvidence` |
| 14:18:28.274 | Job `48bf41d3` FAILED `MANIFEST_NOT_BUILT` | `jobs.error` |
| 14:19:38.162 | Job `df76c2be` created (operator's retry, same payload) | `jobs.created_at` |
| 14:19:49 | **Last line ever written to worker.log** — "heartbeat succeeded" | worker.log |
| 14:19:52.363 | **Last heartbeat the API ever received** | `workers.last_heartbeat_at` |
| 14:19:52 → 15:09 | Zero HTTP requests from worker `accd0a71`; `DESKTOP-A629N4N` heartbeating normally throughout | `pm2 logs dyo-api` |

The log tail that suggested "the worker kept running after the inspection" ends
at 14:19:49. Everything after that point is silence, not health. The server-side
view is unambiguous: the API received **nothing** from this worker for ~50
minutes, while a second worker on the same API heartbeated every 15 seconds.

## Two independent root causes

### 1. The inspection failure — an unsaved project blocking `app.open()`

`ae_health` proves After Effects was holding an **unsaved `Untitled` project
with 46 items** at the moment of the open. Opening a different project against a
dirty, never-saved project raises a modal save-changes prompt, which blocks the
scripting bridge; `system.runJsx` then times out at 30s and the inspector
correctly degrades to a raw capture rather than fabricating a manifest.

The same signature appears in 4 of the last 5 inspection attempts for this
template. `beginSuppressDialogs` does not help, because the script never gets to
run.

**Still open.** The deterministic fix is a pre-open precondition gate: `ae_health`
already reports `projectOpen` / `projectPath` / `numItems`, so the worker can
detect "AE holds unsaved work that is not my target" *before* burning 30 seconds,
and report an explicit `WAITING_FOR_HUMAN_ACTION` with an exact operator step
instead of an opaque `MANIFEST_NOT_BUILT`.

### 2. The silence — a permanently dead heartbeat loop (FIXED)

`HeartbeatLoop.tick()` re-armed its timer only at the end of its `try` block or
inside its `catch`. Both are reachable only once the awaited promises **settle**.
One non-settling await therefore left the loop with no pending timer and no path
back: the process stayed alive, stopped heartbeating, stopped claiming, and
stopped logging — nothing to see in the log, nothing to retry.

This is the third instance of the same class of defect in this project, after
the MCP probe blocking the heartbeat and the tasklist timeout stalling it. The
principle now enforced in code: **the heartbeat must never await anything
without its own hard ceiling, and must re-arm its timer unconditionally.**

Fixed by `withDeadline` around the whole tick, plus re-arming the timer *before*
notifying any consumer. Three regression tests fail against the previous
implementation. The job-claim call is bounded for the same reason — a claim that
never settles leaves `activeJobCyclePromise` non-null forever, leaving the worker
online, healthy-looking and permanently idle.

## Why two job IDs existed

No bug. Both were dispatched by the same operator from the dashboard:
`48bf41d3` at 14:17:48 (failed, real AE cause) and `df76c2be` at 14:19:38 as a
manual retry 110 seconds later. All nine INSPECT_TEMPLATE jobs for this worker
today share one `created_by_user_id`.

## Reconciliation performed

- `48bf41d3` — left FAILED. Terminal already, and its failure is real and explained.
- `df76c2be` — **CANCELLED** transactionally at 14:35:35Z, with a structured
  reason recorded in `jobs.error`. Cancelled rather than left QUEUED because a
  non-terminal job blocks *every* future INSPECT_TEMPLATE dispatch for that
  worker (`hasNonTerminalJobForOperation`), and it would otherwise have
  auto-fired into the same unresolved AE-open failure the moment the worker
  restarted.

That required hand-editing the database, because **no cancel path existed
anywhere in the API**. That gap is now closed: `POST /api/jobs/:jobId/cancel`,
QUEUED-only.

## Ship-blocker found while packaging

The worker reports its capabilities on every heartbeat, and the API validated
them against a strict enum. Installing the new worker build (which advertises
two new capabilities) **before** deploying the API would have 400'd every
heartbeat and taken FAHADNAKASH permanently offline. Unknown capabilities are now
dropped rather than rejected, and the deployment order is a hard gate below.

## Deployment order — NOT optional

1. Deploy the API/web at commit `51d9ead` first.
2. Only then install the worker update on FAHADNAKASH.

Installing the worker first is safe *after* this release (that is what the
forward-compatibility fix buys), but is **not** safe against the currently
deployed API, which predates it.
