# DYO After Effects Video Agent — Handover

Practical reference for operating the system day to day. For deep
architecture/engineering detail, see `docs/ARCHITECTURE.md`,
`docs/WINDOWS-WORKER.md`, and `CLAUDE.md`.

## What DYO does

DYO turns an approved Envato After Effects template plus a client's own
assets/text into two finished videos (landscape and native 1080×1920
Reels) — automatically, but never without a human checking the result at
each major step. It never generates video from scratch and never lets an
AI "just render something" — every real edit and every render is a
deterministic, pre-approved operation a human signed off on first.

## The four pieces, and what each one is (and isn't) allowed to do

- **Dashboard (the control room).** The web app you and the client use.
  Create projects, review what the AI/inspection found, accept or reject
  suggestions, approve plans/previews, watch worker health, download
  finished renders. It never talks to After Effects directly.
- **AI Agent (the planning/mapping brain).** Your own Anthropic key (Settings
  → AI Providers), used only to *suggest* which asset/text fills which
  placeholder, with its reasoning. It reads evidence you already have
  (the template manifest, your Work Map, asset metadata) and returns
  structured suggestions — nothing else. **It cannot execute JSX, run a
  shell command, touch a Windows path, or trigger a render.** Every
  suggestion sits as PENDING until a human clicks Accept or Reject; nothing
  it proposes is ever applied automatically.
- **Windows Worker (the execution layer).** A small program on the machine
  that has After Effects installed. It only ever does one of six fixed
  things when the dashboard tells it to: check its own health, inspect a
  template, inspect scene evidence, inspect render capabilities, apply an
  approved edit, or render. It never runs arbitrary code — only these six
  pre-built, tested operations.
- **MCP (the bridge to After Effects).** `ae-mcp`, running alongside AE on
  the Worker machine. It's how the Worker reads/edits the AE project
  without hand-written automation scripts talking to AE's UI directly.
- **After Effects (the actual editor/render engine).** Adobe's own
  application. DYO never replaces it — it drives it through the same kind
  of operations a human editor would perform, then renders with Adobe's
  own `aerender.exe`.

## Human approval gates (never skipped)

1. **AI mapping suggestions** — Accept/Reject per suggestion (Mapping
   Assistant tab).
2. **Execution plan approval** — before any scene is executed.
3. **First-scene preview approval** — after the first real edit, before any
   more scenes run.
4. **Final render approval** — implicit in choosing to dispatch
   Landscape/Reels renders once every scene is approved.

If a human never clicks Accept/Approve, nothing happens. There is no
"auto-approve" setting anywhere in this system.

## Setting up the AI Provider (Anthropic)

1. Get an API key from Anthropic (console.anthropic.com).
2. Dashboard → **Settings → AI Providers → Anthropic → Manage/Connect**.
3. Paste the key, pick a model, click **Test Connection** (this makes one
   real, tiny call to Anthropic — nothing is saved yet).
4. Click **Save & Connect**. The key is encrypted on the server
   (AES-256-GCM) and only a masked "last 4 characters" is ever shown again
   — the raw key never comes back to the browser, and no log ever contains
   it.
5. To change keys later, use **Replace Key**. To stop using AI mapping,
   use **Disconnect** (deterministic matching keeps working either way —
   AI is optional, never required for the core workflow).

Without a connected key, the dashboard shows "Connect an AI provider in
Settings to use AI Mapping Assistant" — the rest of the app is unaffected.

## Normal daily operation

1. Dashboard → **New Project** → name it.
2. Pick a connected Worker → fill in the template ID and the path to a
   **copy** of the `.aep` on the Worker machine (never the original) →
   **Inspect Template**.
3. Once inspection succeeds, review the summary and **Create Project**.
4. On the project page: upload/confirm **Assets**, fill in the **Work
   Map** (what goes where), run the **Mapping Assistant** if an AI
   provider is connected, **Accept/Reject** each suggestion, then
   **approve the execution plan**.
5. Start an execution session, execute the first scene, **review the real
   preview** in the dashboard, approve it.
6. Execute the remaining scenes (each accumulates onto the same working
   copy — never a fresh copy from the original).
7. Configure and run **Landscape** and **Reels** renders (Render Settings
   tab), then download the finished files from **Renders**.

The original `.aep` template is never modified at any point — every edit
happens on a working copy the Worker itself creates and hashes.

## Worker auto-start / auto-recovery

Once installed, the Worker:

- **Starts automatically** when the configured Windows user logs in (no
  manual start needed after a normal reboot).
- **Restarts itself automatically** within about a minute if its process
  ever crashes for any reason (Windows Task Scheduler's own
  RestartCount/RestartInterval — no client action).
- **Survives a lost internet connection or a temporary DYO outage** — it
  keeps retrying with backoff and reconnects on its own once the network
  or the API is back. It never needs to be manually restarted for this.
- **Survives After Effects or the ae-mcp bridge being closed** — it stays
  connected to DYO and simply reports AE/MCP as offline until they're
  reopened, at which point health flips back to ONLINE automatically.
- **Never runs two copies at once** — the Scheduled Task refuses to start
  a second instance while one is already healthy.

If the dashboard's Workers page shows a worker stuck OFFLINE for more than
a few minutes, the machine itself needs checking (powered on? logged in?)
— see Troubleshooting below.

## How to update the Worker

1. Extract the latest `deploy/DYO-Windows-Worker-FINAL-UPDATE.zip` on the
   Worker machine (keep all the files together in one folder).
2. Double-click `DYO-Worker-Final-Update.bat`.
3. It stops the Worker safely, replaces the program files, refreshes its
   Windows auto-recovery settings, restarts it, and verifies the restart
   actually worked (including the exact expected build) before printing
   "Update complete". No terminal knowledge or password needed.
4. If it prints `[NEEDS ATTENTION]`, it stops and tells you exactly which
   check failed — re-running the update is always safe.

This never touches `.env`, never asks for a new registration code, and
never opens/changes/renders any After Effects project itself.

## Troubleshooting / runbook

| Symptom | What to check | What NOT to do |
|---|---|---|
| Worker shows OFFLINE on the Workers page | Is the machine powered on? Is the configured Windows user logged in (the Worker only auto-starts at logon)? Is `DYO Video Worker` visible in Windows Task Scheduler? | Don't reboot repeatedly - check logon state first |
| AE/MCP show OFFLINE but Worker is ONLINE | Is After Effects actually running? Is `ae-mcp` running (check its own status panel)? | Don't restart the whole Worker for this - it recovers on its own once AE/MCP are back |
| A dispatch is refused with "precondition not met" | The dashboard always re-checks Worker/AE/MCP status live at dispatch time, never a stale cached value - the message names exactly which one failed | Don't retry blindly - fix the named precondition first |
| Update reports `[NEEDS ATTENTION]` | Read the exact printed reason - it names the failing step | Don't assume the update silently failed elsewhere - it never prints success until every check passes |
| Mapping Assistant says "not connected" | Settings → AI Providers → reconnect | Deterministic matching still works without AI - this never blocks the workflow |
| A render fails | Check `AERENDER_PATH`/`AE_MCP_PATH` are set in the Worker's own `.env` (see `.env.example`) | Never edit the rendered output by hand - re-run the render job |
| A job fails with `AE_UNRESPONSIVE (BRIDGE_TIMEOUT)` | AE has no API to directly detect a stuck modal dialog, so this is the honest, closest signal for one - check the AE window on the Worker machine for a blocking dialog (missing-font/overwrite-confirmation prompts are the usual cause) and resolve it, or restart AE if genuinely hung | Don't just re-dispatch blindly without checking AE first - confirm CHECK_HEALTH shows AE/MCP ONLINE again, then re-dispatch the same scene; already-completed operations are skipped automatically, never re-applied |
| A plan won't approve - "does not satisfy the required DYO brand rules" | The plan's active scenes are missing the logo and/or the Hebrew "מבית DYO App" text - map both in the Work Map/scene table before approving | This is a real backend gate (`dyo-brand-rules.yaml`), not a bug - it cannot be bypassed from the dashboard by design |

Every job's real status, error, and (for INSPECT_TEMPLATE) result is
readable from the dashboard itself — there is never a need to query the
database or the API directly to see what happened. The Jobs page's own
**Job history** section lists every job you have dispatched, newest first,
with worker/project names and the real error already resolved.

## Interrupted jobs (worker crash mid-scene)

If the Worker process is killed or crashes mid-EXECUTE_FRAME or mid-RENDER,
its already-completed operations are durably checkpointed. Once the Worker
is back online, simply re-dispatch the same scene/render from the
dashboard exactly as normal - the system automatically carries the last
confirmed checkpoint into the new job and skips whatever already
completed. No special "resume" button or manual step is needed.

## Native Reels (1080x1920)

A scene's Reels output is configured as part of its own plan content (a
`reelsLayout`: the new composition's name plus explicit position/scale
values per layer) — set via the same execution-plan-edit API every other
scene edit uses. Once approved, EXECUTE_FRAME builds the real, non-
destructive 1080x1920 duplicate composition (never a crop) as the last
step of that scene's job, repositioning only layers with no existing
keyframe animation on position/scale (a layer that already has real
animation there is left untouched, with a clear typed failure, rather than
risk destroying it). The new composition is then automatically registered
on the project, so it appears in the Render Settings dropdown right away —
no manual step, no DB/curl access needed. Configure and dispatch RENDER
REELS exactly the same way as Landscape.

## Backup / recovery notes

Two things hold real state and should be backed up regularly:

1. **The PostgreSQL database** (`DATABASE_URL` in the server's `.env`) —
   every project, manifest, work map, mapping suggestion, execution plan,
   job history, and render-artifact record lives here. A standard
   `pg_dump` on a schedule is sufficient; there is nothing exotic about
   this database.
2. **The asset storage directory** (`ASSET_STORAGE_ROOT` in the server's
   `.env`) — the real uploaded asset/render-artifact bytes referenced by
   the database above. Back these up together, in step, so a restored
   database's file references stay valid.

The original client `.aep` template files themselves are never modified
by this system (CLAUDE.md Safety Rule 1) and are hash-verified unchanged
after every operation — they do not need special backup handling beyond
however the client already stores their own template library.

Windows Worker state (its paired credentials, work root) is local to that
one machine and is re-established by re-running the setup package if the
machine is ever replaced — it is not part of the server-side backup above.
