# DYO After Effects Video Agent — Claude Code Instructions

## Mission
Build a reusable production system that reads Envato After Effects templates, discovers scenes and editable placeholders, produces a human-approval production table, then safely generates branded landscape and native 1080x1920 Reels videos from the approved plan.

This is NOT a generic AI video generator. It is a deterministic After Effects automation system with human approval gates.

## Locked Architecture
- Contabo: dashboard, API, PostgreSQL database, job queue/state, approvals, logs, worker registry.
- Windows Worker: runs on the machine that has After Effects 2026 installed.
- Initial Worker 1: client's existing Windows PC.
- After Effects control: existing/newer `ae-mcp` bridge plus deterministic JSX/ExtendScript.
- Media tools: FFmpeg + FFprobe.
- Final render: `aerender.exe`, separate from editing operations.
- Language/runtime: TypeScript, Node.js 24, npm workspaces.
- Backend: Fastify.
- Web: Next.js + React.
- Database: PostgreSQL + Drizzle ORM.
- Validation: Zod + JSON Schema.
- Deployment: Docker Compose on Contabo for web/api/db. Windows worker runs natively.
- One AE job per worker initially: `maxConcurrency = 1`.
- Architecture must be multi-worker capable from Day 1.

Do NOT redesign this architecture unless a hard technical blocker is proven and documented.

## Production Connection Model
The Windows worker connects OUTBOUND to Contabo over HTTPS/WebSocket/polling. Do not require permanent AnyDesk/RDP, inbound ports, router port forwarding, public IP, or client Windows credentials.

## Paid Services
Do not add Nexrender Cloud, Plainly, Adobe cloud rendering, or any other paid render SaaS as an MVP dependency.

## Runtime AI
Runtime AI is optional. Deterministic code must control paths, timing, project changes, validation and rendering. If semantic AI is later added, put it behind a provider abstraction; never make it mandatory for the core workflow.

## Safety Rules
1. Never overwrite the original `.aep` template.
2. Never execute arbitrary AI-generated JSX in production. Only execute tested, versioned, allowlisted scripts/operations.
3. Every JSX mutation must use:
   `app.beginUndoGroup("operation"); try { ... } finally { app.endUndoGroup(); }`
4. Rendering must never run inside an UndoGroup.
5. Editing and rendering are separate job stages.
6. Restrict worker file access to its configured work root.
7. Do not put secrets, Windows passwords or Adobe credentials in source control.
8. Hash source `.aep` files before processing and verify originals remain unchanged.
9. On MCP heartbeat loss or suspected AE modal, pause safely instead of endless retries.

## Permanent DYO Brand Rules
- Client/company logo must appear at least once in every video.
- Every video must include Hebrew text: `מבית DYO App` (By DYO App).
- DYO App branding must always use the official DYO blue supplied in configuration.
- Remaining background/colors/visual language adapt to the client brand and chosen template.
- Do not recolor client screenshots, client logos or phone hardware unless explicitly requested.

## Required Data Model
Keep machine discovery separate from human approval:
- `template-manifest.json`: machine-generated scene/placeholder discovery.
- `execution-plan.json`: human-approved final sequence and assignments.
- `dyo-brand-rules.yaml`: reusable permanent branding configuration.

Stable placeholder IDs must be independent of human display labels.

## Required Workflow
1. Intake and folder validation.
2. Template/plugin/font/missing-footage preflight.
3. Asset inventory and work-map parse/validate.
4. Read-only template inspection and scene discovery.
5. Generate `template-manifest.json`.
6. Generate dynamic scene/placeholder approval table.
7. Human maps/reorders/selects scenes and approves execution plan.
8. Safe copy/versioning of project and dependencies.
9. First-frame execution only.
10. Real visual preview and style approval.
11. Apply DYO/client brand rules.
12. Brand/typography approval.
13. Execute remaining approved scenes.
14. Create landscape output.
15. Create true native 1080x1920 Reels composition by repositioning actual elements, not simple crop.
16. Visual QA using actual previews from exact output comp.
17. Final human approval.
18. Prepare render.
19. Run separate recoverable `aerender` job.

## Approval Gates
Pause for human approval after:
- preflight + scene mapping,
- first designed frame,
- brand color + typography,
- complete preview,
- before final render.

## Recovery Behavior
Worker must represent and recover from at least:
- `MCP_DISCONNECTED`
- `AE_HEARTBEAT_LOST`
- `AE_MODAL_SUSPECTED`
- `WAITING_FOR_HUMAN_ACTION`
- `RETRYABLE`
- `FAILED`
- `RESUMING`

Checkpoint after every major stage. Resume from last valid checkpoint after the problem is resolved.

## MVP Acceptance
Do not call MVP complete until three different plugin-free templates pass end-to-end with:
- original `.aep` unchanged,
- selected scenes only,
- correct assets/text,
- timestamp accuracy within one source frame,
- actual visual previews,
- landscape output,
- native 1080x1920 Reels output,
- one interrupted-job recovery test.

## Development Method
Work phase-by-phase. At the end of each phase:
1. run tests,
2. update docs,
3. show files changed,
4. state blockers,
5. stop at the defined checkpoint if the phase says approval is required.

Read `docs/MASTER_PLAN.md` and `docs/PHASES.md` before coding.
