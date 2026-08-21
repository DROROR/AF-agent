# Implementation Phases

## Phase 0 — Repository + Client Preflight + Existing POC Audit
### Build
- ensure npm workspace structure,
- add TypeScript/base lint/test config,
- create `scripts/preflight/` read-only Windows preflight,
- audit `C:\AI-Tools\ae-mcp` read-only,
- document how MCP starts, communicates, heartbeats and reconnects,
- inspect successful POC artifacts read-only where accessible,
- identify reusable tools/scripts and gaps.

### Deliverables
- `docs/AUDIT.md`
- `scripts/preflight/DYO-Preflight.ps1`
- optional thin `DYO-Preflight.bat` launcher
- no project mutation.

### Checkpoint
Stop after audit if a hard blocker is found. Otherwise continue only after summarizing reusable components and the Phase 1 plan.

---

## Phase 1 — Contabo API, Database and Worker Registry
### Build
- Fastify API skeleton,
- PostgreSQL/Drizzle schema,
- worker registry,
- worker token auth,
- worker capabilities,
- heartbeat endpoint,
- worker status model,
- job table/state skeleton,
- minimal Next.js worker-status screen.

### Worker heartbeat payload
Include:
- worker id,
- app version,
- hostname label (non-sensitive display label),
- AE detected/version/status,
- MCP status,
- last MCP heartbeat,
- maxConcurrency,
- current job,
- capabilities.

### Milestone
Dashboard shows:

```text
Worker 1: ONLINE
AE: ONLINE
MCP: ONLINE
Last heartbeat: <fresh>
maxConcurrency: 1
```

No AE editing yet.

---

## Phase 2 — Worker Job Channel + Health/Recovery Foundation
### Build
- outbound worker connection/polling/WebSocket strategy,
- claim one compatible job atomically,
- predefined operation allowlist,
- worker logs/checkpoints,
- health state transitions,
- MCP disconnected / AE offline / suspected modal handling,
- safe pause/resume.

### Tests
- stop MCP -> status changes safely,
- restart MCP -> worker recovers,
- close AE -> AE_OFFLINE,
- reopen AE -> recover,
- no duplicate job claim.

---

## Phase 3 — Read-only Template Inspector
### Build
Inspect an `.aep` without modifying the source and generate `template-manifest.json`.

Discover:
- project metadata,
- top-level comps,
- nested dependencies,
- scene candidates,
- scene start/end/duration,
- layers,
- text layers,
- footage/image layers,
- logo candidates,
- phone/display placeholders,
- matte/mask relationships,
- fonts,
- effects/plugin references,
- color inventory,
- missing footage.

Use stable IDs independent of display names.

### Milestone
First real template produces a validated manifest and a readable scene inventory.

---

## Phase 4 — Dynamic Approval Table + Execution Plan
### Dashboard
For each discovered scene expose:
- Use: Yes/No,
- Final Order,
- Scene label,
- Placeholder label,
- Asset assignment,
- Text or `No Text`,
- Video timestamp,
- Final duration,
- Special instructions.

Examples of distinct placeholders:
- Left Phone
- Right Phone
- Main Image
- Logo
- Main Headline
- Supporting Text

Final sequence must not depend on original scene order.

### Output
Generate/validate `execution-plan.json`.

### Approval gate
Do not execute AE changes until mapping approval is recorded.

---

## Phase 5 — Safe Project Preparation + First Frame
### Build
- source hash,
- isolated job workspace,
- safe project copy/save-as,
- dependency-aware duplication,
- import/relink operations,
- exact timestamp still extraction,
- asset replacement,
- first approved frame only.

### Approval gate
Capture a real preview from exact output comp and wait for style approval.

---

## Phase 6 — Typography + Branding
### Build
- Hebrew RTL/right alignment handling,
- Heebo font mapping,
- text box/clipping protection,
- DYO/client logo placement rules,
- official DYO blue config,
- recursive safe color handling,
- exclusions for screenshots/logos/phone hardware.

### Approval gate
Wait for brand/color/typography approval.

---

## Phase 7 — Remaining Scenes + Landscape
Execute all approved scenes using the locked execution plan and approved style. Produce landscape preview/output comp. Capture actual previews.

---

## Phase 8 — Native Reels
Create real 1080x1920 output composition and reposition actual elements for portrait. Preview at representative points (approximately 25%, 50%, 75%, final) and verify the exact output comp.

---

## Phase 9 — QA + Final Approval + Render
### QA
- selected scenes only,
- expected final order,
- required logos/text,
- timestamps correct,
- no missing footage/fonts,
- no obvious clipping,
- correct output dimensions,
- source template hash unchanged.

### Approval gate
Wait for final preview approval.

### Render
Prepare render queue and run `aerender` separately. Persist render status/logs and support resume/retry.

---

## Phase 10 — Three-template MVP Validation
Run end-to-end on three different plugin-free templates. Record eval results and rejected outputs/reasons. Run one intentional interruption/recovery test. Finalize setup/runbook docs.
