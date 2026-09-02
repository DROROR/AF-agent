# MVP Runbook

## Ports

- `dyo-api`: `127.0.0.1:4000` (never exposed publicly directly).
- `dyo-web`: `127.0.0.1:4100` (`deploy/pm2/ecosystem.config.cjs`'s own
  `-p 4100` is the single source of truth for this) - **never 3000**.
  Port 3000 on the shared production host belongs to a completely
  unrelated NestJS application; DYO's own deploy/health-check scripts
  never reference it (see `scripts/__tests__/deploy-health-check.test.ts`'s
  own regression coverage for this, added 2026-09-02 after this was
  confirmed as a real operational mix-up during a live session, never an
  actual bug in the tracked deploy pipeline itself).

## Normal client flow (final MVP nav, 2026-09-02)

The dashboard's default UI hides technical IDs/operation codes from a
normal client, and every project page shows a real 7-step workflow
stepper (`ProjectWorkflowStepper.tsx`) as the PRIMARY orientation layer -
"Step X of 7 — <Title>" plus one plain sentence of what to do now. Every
step's complete/current/locked state is derived from real persisted facts
(`project-workflow-steps.ts`) - never from which page has been visited.

Simple Mode's own tab bar (secondary/direct navigation) reads exactly
**Project / Files / Scenes / Preview / Export** (`ProjectWorkspaceShell.tsx`'s
`tabsFor`) - Work Map / Render Settings / Revisions only appear once
Advanced Mode is selected, never in Simple. "Preview" (`ProjectPreviewTab.tsx`)
holds both the First Preview and Final Preview approval gates; "Export"
(`ProjectExportTab.tsx`) holds a plain-language render trigger per variant
plus the same real download/playback list Advanced's Render Settings tab
shows (`FinalOutputsCard`, shared between both).

1. **Upload** - create the project, upload the `.aep` template (dispatches
   INSPECT_TEMPLATE on a worker under the hood) and assets.
2. **Tell Claude** - a plain-language textarea drives an AI Work Map draft
   via the dedicated Claude-branded action button (`ClaudeActionButton.tsx`
   - only ever shown where a real Anthropic call genuinely happens).
   Draft-only: never auto-approves anything, never touches AE - see
   `generate-ai-work-map-draft.ts`.
3. **Review Plan** - a human-readable table (Scene/Content/Text/Duration/
   Action), real scene names and asset filenames, never raw IDs. Raw
   composition/asset/mapping IDs remain available under "Advanced
   details" - never deleted from the data model, just not shown by default.
4. **Mappings** - the Mapping Assistant, grouped by scene, plain-language
   confidence (High/Medium/Needs review). "Improve AI accuracy" (see
   below) is available per scene. A strict "Accept All Safe Suggestions" /
   "Accept All in This Scene" bulk-review path exists alongside individual
   Accept/Reject (see "Bulk mapping review" below) - the plan must then be
   approved to continue.
5. **First Preview** - dispatch the first scene edit, review the real
   captured preview image, approve or reject it.
6. **Final Preview** - once every approved scene has completed, this step
   shows as the guided checkpoint to review the finished result before
   rendering (see "Final Preview - honest framing" below - this is a UI
   checkpoint, not a new backend approval flag).
7. **Render** - configure Landscape/Reels output (Advanced), render from
   Simple Mode's own Export tab, then a real "Final Outputs" section
   (`FinalOutputsCard`, shown on both Export and Advanced's Render
   Settings tab) shows each completed artifact with an actual
   in-dashboard video player (`VideoArtifactPlayer.tsx`) and a working
   authenticated download link - never a fake placeholder for an artifact
   that doesn't really exist yet.

This is presentation only - every technical requirement below (Template
Manifest, Work Map persistence, Execution Plan, deterministic AE
execution, `.aep` protection, approval gates, checkpoint/recovery) is
unchanged underneath.

### Final Preview - real, separate approval gate (updated 2026-09-02)

Superseded note: an earlier revision of this section said there was no
distinct backend-persisted "final preview approved" flag - that has since
been built for real and this correction replaces it. `execution_sessions.
full_preview_approved` is a real, persisted boolean, completely separate
from `first_preview_approved`. `resolve-render-dispatch.ts`'s real RENDER
precondition requires ALL of: `firstPreviewApproved`, every required
scene in `completedScenePlanIds`, a full-preview artifact that exists AND
whose `workingProjectSha256` matches the session's current working copy
(never a stale preview captured against an older edit), AND
`fullPreviewApproved` itself - confirmed directly from that file. Set only
via `POST .../approve-final-preview` (`approve-final-preview.ts`), which
itself refuses unless a fresh, matching full-preview artifact exists.
`project-workflow-steps.ts`'s own `fullPreviewApproved` input is this SAME
real flag, never derived from `allScenesComplete` alone. In the dashboard
this is the Preview tab's Final Preview card - Approve Final Preview /
Request Changes (`ProjectPreviewTab.tsx`).

### Bulk mapping review

`isSafeToBulkAccept` (`safe-bulk-accept.ts`) reuses the Mapping
Assistant's OWN existing trust signals - `requiresHumanReview: false`
(only the deterministic matcher's highest-trust rules: an explicit Work
Map assignment, or a brand-logo match), `unresolvedReason: null` (not
already downgraded by the low-confidence-guess safety gate), `confidence
>= 0.75`, and no Work Map conflict. This is a client-side selection
convenience only, never a security boundary - `/mapping-suggestions/
accept-batch` independently re-validates every id server-side regardless.

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
