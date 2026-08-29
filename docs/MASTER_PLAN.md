# DYO AE Video Agent — Master Development Plan

## 1. Product Goal
The system receives:
- Envato After Effects template and dependencies,
- initial work map,
- client screenshots/screen recordings/logos/assets,
- frame text,
- client brand colors/typography,
- landscape/Reels requirement.

It discovers template scenes/placeholders, creates a human-editable approval plan, then performs deterministic After Effects production without changing the original template.

## 2. Final Architecture

```text
Clients / DYO Team
       |
       v
Contabo Web + API + PostgreSQL
       |
       +--> Job Queue / State / Approvals / Logs
       |
       v
Worker Scheduler / Registry
       |
       +-------------------------+
       |                         |
       v                         v
Worker 1                     Worker 2+
Client Windows PC            Future cloud Windows worker
       |                         |
       v                         v
After Effects 2026 + ae-mcp + deterministic JSX
       |
       +--> FFmpeg/FFprobe
       +--> Preview capture
       +--> aerender
```

Current MVP uses Worker 1 only. Future multiple-client scale is achieved by registering more compatible workers; backend/dashboard stays the same.

## 3. Worker Connection

```text
Windows PC
  After Effects
  ae-mcp
  DYO Worker
      |
      | outbound HTTPS/WebSocket/polling
      v
Contabo API
```

No permanent remote desktop requirement. Remote desktop is optional only for one-time setup/debug.

## 4. Repository Target

```text
dyo-video-agent/
  CLAUDE.md
  README.md
  package.json
  docker-compose.yml
  .env.example

  apps/
    web/
    api/
    worker/

  packages/
    core/
    schemas/
    database/
    branding/
    media/

  ae/
    jsx/
    mcp/
    references/

  docs/
    MASTER_PLAN.md
    PHASES.md
    CLIENT_WORKER_PREFLIGHT.md
    ARCHITECTURE.md
    SCHEMAS.md
    RUNBOOK.md
    ACCEPTANCE.md

  examples/
  evals/
  tests/
```

> **Current status (2026-08-29):** this is the ORIGINAL planning-stage
> target, kept for historical record - the real repository differs in a
> few places: no `packages/core`/`branding`/`media` or `ae/` directory
> exist (their real equivalents live inside `apps/worker/src/execution` and
> `apps/api/src/domain/brand-rules`); `packages/renderer` exists instead
> (an experimental Shotstack-POC package, not wired into production);
> `examples/` and `evals/` now exist for real (see section 6's own status
> note and `evals/README.md`); root-level tests live alongside their own
> source files (`__tests__/` per module), not in a separate top-level
> `tests/` directory. See the real, current layout in this repo's own
> `README.md` instead of this historical sketch.

## 5. Windows Worker Root

```text
C:\DYO-Agent\
  worker\
  jobs\
  templates\
  outputs\
  previews\
  checkpoints\
  logs\
```

All job-controlled file operations must stay inside this configured root except read-only access to explicitly supplied source/template paths during controlled intake.

## 6. Initial Worker Operations Allowlist

```text
CHECK_HEALTH
INSPECT_TEMPLATE
VALIDATE_PLAN
PREPARE_PROJECT
EXECUTE_FRAME
APPLY_BRANDING
CREATE_PREVIEW
CREATE_HORIZONTAL
CREATE_REELS
PREPARE_RENDER
RENDER
RESUME_JOB
```

Never expose arbitrary shell execution through the job API.

> **Current status (2026-08-29):** this was the ORIGINAL planned
> allowlist. The real, dispatchable operation set is the 6 named in
> `apps/worker/src/domain/operation-allowlist.ts`'s
> `CURRENT_WORKER_CAPABILITIES`: `CHECK_HEALTH`, `INSPECT_TEMPLATE`,
> `INSPECT_SCENE_EVIDENCE`, `INSPECT_RENDER_CAPABILITIES`, `EXECUTE_FRAME`,
> `RENDER`. The remaining names above (`VALIDATE_PLAN`, `PREPARE_PROJECT`,
> `APPLY_BRANDING`, `CREATE_PREVIEW`, `CREATE_HORIZONTAL`, `CREATE_REELS`,
> `PREPARE_RENDER`, `RESUME_JOB`) are still declared in the schema's
> `WORKER_CAPABILITIES` enum as reserved/planned names (kept for forward
> compatibility - removing a declared capability is a breaking schema
> change), but **have no execution handler and are never dispatchable
> today**. Their intended functionality was folded into the 6 real
> operations instead of being built as separate dispatch steps: branding
> and native-Reels-composition-building are both EXECUTE_FRAME operation
> types (`SET_BRAND_COLOR`, `BUILD_REELS_COMPOSITION` - see
> `packages/schemas/src/execute-scene-edit.ts`), not their own job
> operations; "prepare project"/"prepare render" are internal executor
> stages, not separate dispatched jobs; `RESUME_JOB` was superseded by true
> checkpoint-carrying resume on the EXISTING EXECUTE_FRAME/RENDER dispatch
> path (`resolve-resume-checkpoint.ts`) rather than a distinct operation.

## 7. Job Lifecycle

```text
NEW
PREFLIGHT
INSPECTING
MAPPING_READY
WAITING_MAPPING_APPROVAL
PREPARING_PROJECT
EXECUTING_FIRST_FRAME
WAITING_STYLE_APPROVAL
APPLYING_BRANDING
WAITING_BRANDING_APPROVAL
EXECUTING_REMAINING_FRAMES
CREATING_HORIZONTAL
CREATING_REELS
QA
WAITING_FINAL_APPROVAL
RENDER_READY
RENDERING
COMPLETED
```

Recovery states:

```text
MCP_DISCONNECTED
AE_HEARTBEAT_LOST
AE_MODAL_SUSPECTED
WAITING_FOR_HUMAN_ACTION
RETRYABLE
FAILED
RESUMING
```

> **Current status (2026-08-29):** the real job state machine
> (`packages/schemas/src/job.ts`) is `QUEUED`/`CLAIMED`/`RUNNING`/
> `WAITING_FOR_ACTION`/`SUCCEEDED`/`FAILED`/`CANCELLED` - a smaller, more
> generic set than the original per-stage lifecycle above (there is no
> separate `MAPPING_READY`/`EXECUTING_FIRST_FRAME`/`CREATING_REELS` status;
> those are dashboard-level workflow steps built on top of the generic
> job/plan/session state, not distinct job statuses). Of the recovery
> states above: `MCP_DISCONNECTED`/`AE_HEARTBEAT_LOST`/`AE_MODAL_SUSPECTED`/
> `RETRYABLE`/`RESUMING` were never implemented as distinct states -
> `docs/RUNBOOK.md`'s "MCP/AE issue" section documents the real, honest
> equivalent (an `AE_UNRESPONSIVE (BRIDGE_TIMEOUT)`-classified failure
> message plus true checkpoint-carrying resume on re-dispatch). `FAILED` is
> real and used exactly as named. `WAITING_FOR_HUMAN_ACTION` maps to the
> schema's own `WAITING_FOR_ACTION` value, which is declared and counted as
> an active status but has no code path that ever transitions a job into it
> today - reserved, not currently reachable.

## 8. Deterministic AE Capabilities Required
Build/version tested scripts for:
- project/template preflight,
- required plugin detection,
- missing footage inspection and controlled relink,
- scene/composition discovery,
- dependency-aware comp duplication,
- safe save-as/versioning,
- asset import,
- exact timestamp still extraction and hold,
- phone/matte replacement,
- text replacement,
- Hebrew RTL/right alignment/text box safety,
- font replacement,
- recursive color inventory/change,
- output-comp preview capture,
- horizontal output prep,
- native Reels prep,
- MCP health/reconnect checks,
- render queue preparation.

## 9. Timestamp Handling
When a screenshot is supplied as a screen recording/video:
1. validate timestamp from execution plan,
2. inspect media via FFprobe,
3. deterministically extract exact source frame via FFmpeg,
4. place still in AE,
5. hold it for the approved scene duration.

Acceptance tolerance: within one source frame.

## 10. Reels Rule
Reels must be a native 1080x1920 composition. Reposition real phone/text/logo/background/decorative elements for 9:16. Preserve screenshot crop/masks/mattes/bezel/status elements. Do not just crop a landscape render.

> **Current status (2026-08-29):** implemented via a new EXECUTE_FRAME
> operation, `BUILD_REELS_COMPOSITION` (`packages/schemas/src/execute-scene-edit.ts`,
> `apps/worker/src/execution/jsx-templates.ts`) - it duplicates the scene's
> already-edited landscape composition with AE's own non-destructive
> `CompItem.duplicate()` (never a crop), resizes ONLY the duplicate to
> 1080x1920, then repositions/rescales each layer to explicit,
> human-approved coordinates persisted on the plan's own `reelsLayout`
> (`packages/schemas/src/execution-plan.ts`) - refusing (typed failure) to
> touch any layer whose position/scale already carries real keyframe
> animation, so existing animation is never silently destroyed. Fully
> tested against fakes; never yet run against real AE 2026 (no client
> hardware access this session). **One real gap remains**: once built, the
> new composition is not yet automatically added to the project's own
> manifest, so today it cannot be selected from the existing Render
> Settings dropdown (which only lists manifest-known compositions) without
> a small follow-up - see this file's own note in `docs/ACCEPTANCE.md`.

## 11. Initial Scaling/Fallback

```text
All jobs -> Contabo scheduler
               |
       +-------+-------+
       |               |
       v               v
Worker 1           Worker 2/3 later
Client PC          On-demand cloud Windows
$0 extra MVP       Only when queue grows
```

Cloud worker candidates can be evaluated later. The software architecture must not depend on a specific cloud vendor.

## 12. Timeline
Target: 7-10 working days for MVP, with approximately one week as internal full-focus target if existing POC/ae-mcp components are reusable.
