# MVP Runbook

## Start order
1. Start Contabo database/API/web.
2. Start Windows DYO Worker.
3. Worker verifies local dependencies.
4. Start/verify AE + ae-mcp when required by the job.
5. Confirm dashboard worker health.

## Worker health target

```text
Worker: ONLINE
AE: ONLINE
MCP: ONLINE
Last heartbeat: fresh
Current job: none or valid job id
maxConcurrency: 1
```

## Job execution (real current flow - the real Worker has exactly 6 dispatchable
operations: CHECK_HEALTH, INSPECT_TEMPLATE, INSPECT_SCENE_EVIDENCE,
INSPECT_RENDER_CAPABILITIES, EXECUTE_FRAME, RENDER - see
`apps/worker/src/domain/operation-allowlist.ts`'s `CURRENT_WORKER_CAPABILITIES`.
There are no separate dashboard steps for "approve style"/"apply branding"/
"create landscape"/"create native Reels" as distinct operations - branding
and Reels layout are configured as part of the Work Map/execution plan
BEFORE EXECUTE_FRAME runs, not as their own dispatch steps.)
1. Create the project (New Project wizard dispatches INSPECT_TEMPLATE on a
   worker, then promotes the result into a real project + manifest).
2. Upload assets, fill in the Work Map.
3. Run the AI Mapping Assistant (optional) and/or map manually; review the
   dynamic scene table.
4. Approve the execution plan (hard-blocked if any active scene has an
   unresolved reason or fails the permanent DYO brand-rule check - see
   `dyo-brand-rules.yaml`).
5. Start an execution session; dispatch EXECUTE_FRAME for the first scene;
   review the real captured preview in the dashboard; approve it.
6. Dispatch EXECUTE_FRAME for the remaining scenes (each accumulates onto
   the same working copy). A scene with an approved Reels layout
   (`reelsLayout` on its scene plan) builds its native 1080x1920
   composition as the LAST operation of that same job.
7. Configure Render Settings (Landscape, and Reels once its composition
   exists) and dispatch RENDER for each variant.
8. Download/play back the finished artifacts from the Renders page.

## MCP/AE issue - the REAL, truthful failure model
AE exposes no API this system can call to directly ask "is a modal dialog
open right now" - there is no dedicated modal detector, and nothing in this
codebase claims to have one. What actually happens on an unresponsive
AE/bridge:
- a request to ae-mcp that does not respond within its configured timeout
  is classified `AE_UNRESPONSIVE (BRIDGE_TIMEOUT)` - the practical,
  honestly-labeled equivalent of a suspected stuck modal (most often
  caused by exactly that - a missing-font or overwrite-confirmation
  dialog) - see `apps/worker/src/execution/classify-mcp-failure.ts`,
- the in-flight scene edit stops at the failed operation and never
  attempts the next one (never a partial, silently-continued mutation),
- whatever operations already completed are durably checkpointed before
  the failure - never lost,
- the job is reported FAILED with that classified message (visible on the
  dashboard's Jobs page - job history - no DB access needed),
- **NEEDS HUMAN ACTION**: check the AE window on the Worker machine for a
  blocking dialog and resolve it (or restart AE if genuinely hung), confirm
  CHECK_HEALTH reports AE and MCP both ONLINE again,
- then simply re-dispatch the same scene/job - the dashboard automatically
  carries the last confirmed checkpoint into the new dispatch (see
  `resolve-resume-checkpoint.ts`), so already-completed operations are
  skipped, never re-applied.

A worker-to-API heartbeat going stale (`AE_HEARTBEAT_LOST`-equivalent) is
handled separately and automatically: `apps/api/src/application/job/sweep-stale-jobs.ts`
fails any job whose worker's heartbeat has gone stale, and the Workers page
shows the real "last heartbeat" age live - no separate alert needed.

## Original safety
Before mutation:
- hash source `.aep`,
- create job copy/version,
- use only job copy for modifications.

After completion:
- re-hash original and verify unchanged.
