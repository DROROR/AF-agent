# MVP Runbook

## Normal client flow (dashboard-simplification phase, 2026-08-31)

The dashboard's default UI hides technical IDs/operation codes from a
normal client. What they actually click, in order:

1. **Create Project** - name it, upload the `.aep` template (dispatches
   INSPECT_TEMPLATE on a worker under the hood).
2. **Upload Template & Assets** - screen recordings, logo, images.
3. **Tell AI What You Want** - a plain-language textarea drives an AI
   Work Map draft (draft-only: never auto-approves anything, never touches
   AE - see `generate-ai-work-map-draft.ts`).
4. **Review Video Plan** - a human-readable table (Scene/Content/Text/
   Duration/Action), real scene names and asset filenames, never raw IDs.
   Raw composition/asset/mapping IDs remain available under "Advanced
   details" - never deleted from the data model, just not shown by default.
5. **Review Scene Mappings** - the Mapping Assistant, grouped by scene,
   plain-language confidence (High/Medium/Needs review). "Improve AI
   accuracy" (see below) is available per scene here.
6. **Create First Preview / Approve Full Preview** - the same human
   approval gates as before, unchanged.
7. **Render Landscape / Reels**.

This is presentation only - every technical requirement below (Template
Manifest, Work Map persistence, Execution Plan, deterministic AE
execution, `.aep` protection, approval gates, checkpoint/recovery) is
unchanged underneath.

## What can be done with the client PC offline vs. what needs it ONLINE

**CAN be done with the client Windows PC offline** (control-plane only,
never reaches ae-mcp/AE):
- create/list/delete a project,
- upload assets,
- AI Work Map drafting ("Tell AI what you want"),
- Mapping Assistant suggestion generation (deterministic + AI, both read
  only already-persisted scene evidence/manifest/Work Map - never
  dispatches a new worker job),
- accept/reject mapping suggestions, edit the execution plan,
- Delete Project (refuses with 409 if a job is still in-flight for that
  project - see `delete-project.ts`),
- every dashboard/account/settings/BYOK-AI-provider configuration.

**REQUIRES the Windows PC (Worker + AE + ae-mcp) ONLINE**:
- scene evidence inspection ("Improve AI accuracy" - dispatches a real
  INSPECT_SCENE_EVIDENCE job; the dashboard shows "Your editing computer
  is offline. Turn it on to improve AI accuracy." rather than queuing
  anything when no compatible worker is available - see
  `find-dispatchable-worker.ts`),
- real AE scene edits (EXECUTE_FRAME),
- first preview / full preview capture,
- `aerender` (RENDER),
- interrupted-job recovery/resume,
- the full 3-template MVP acceptance run (CLAUDE.md's MVP Acceptance
  section) - none of those stages can be claimed to have passed while the
  Worker has not actually run them.

### Delete Project - safety contract

`DELETE /api/projects/:projectId` (see `delete-project.ts`) requires an
explicit confirmation dialog naming the real project (never one-click),
refuses with 409 `PROJECT_HAS_ACTIVE_JOB` while any job for that project
is still QUEUED/CLAIMED/RUNNING/WAITING_FOR_ACTION, and deletes every real
AssetStorage object the project owns (uploaded assets, execution-session
previews, render artifacts/uploads) before deleting the DB row (which then
cascades to every project-scoped table). It never touches the Windows
worker's own filesystem - the original client `.aep` is never copied into
Contabo's AssetStorage in the first place, only its path/sha256 live in
the project's manifest, so there is no "original .aep" this operation
could ever delete, by construction.

### "Improve AI accuracy" - safe scene-evidence dispatch

The browser never supplies a raw Windows `sourceProjectPath` or AE layer
indices. It sends only `{ projectId, scenePlanId }`; the server resolves
the real worker payload (`sourceProjectPath`, `sourceProjectSha256`,
`aeProjectItemIndex`, `compositionName`, `layerIndices`) entirely from the
project's trusted, already-persisted manifest and execution plan - see
`resolve-inspect-scene-evidence-dispatch.ts`, the same safe-dispatch
pattern EXECUTE_FRAME/RENDER already use. The operation itself is strictly
read-only (no save, no layer/asset mutation, no approval, no render - see
`scene-evidence.ts`'s own module doc comment) and never auto-regenerates
mapping suggestions - the user always clicks "Generate Suggestions"
explicitly afterward.

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
