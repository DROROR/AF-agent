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
