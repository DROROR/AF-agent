# Architecture Details

## Components
### Web
Next.js/React user interface for jobs, dynamic mapping table, approvals, previews, worker status and logs.

### API
Fastify service responsible for authentication boundary, jobs, worker registry, scheduling, approvals, state transitions and artifact metadata.

### Database
PostgreSQL + Drizzle. Database is the source of truth for job state and worker state. MVP may use database-backed queueing; Redis/BullMQ is not required initially.

### Windows Worker
Native TypeScript/Node service. It:
- registers with API,
- sends heartbeat,
- advertises capabilities,
- claims one compatible job,
- validates job payload,
- calls allowlisted local operations,
- uses ae-mcp/JSX/FFmpeg/aerender,
- emits logs/checkpoints/artifacts,
- pauses safely on AE/MCP problems.

## Multi-worker Scheduler
Worker registry fields should support:
- id,
- status,
- app version,
- AE version,
- capabilities,
- maxConcurrency,
- current job count,
- last heartbeat,
- allowed schedule (future),
- worker class/tags (future).

Job assignment selects a free compatible worker. With one worker, extra jobs wait. With multiple workers, jobs run concurrently.

## Security
- outbound connection from worker,
- TLS to public API,
- per-worker token/pairing token,
- validate all payloads,
- no arbitrary shell API,
- file-root restrictions,
- redact secrets from logs,
- source-control excludes `.env`, credentials and client media,
- initial one-job concurrency.

### Tenancy model (decided 2026-08-29)
This dashboard is a **single-operator control room**, not a multi-client SaaS
login system: any authenticated dashboard user (the DYO team) can see and act
on every project. "Multiple projects/clients" refers to the system running
many independent client **projects** concurrently (each with its own
manifest/assets/work map/execution plan/renders) - that part is fully
supported today. There is no separate client-facing login, and no
per-project data-isolation boundary between dashboard users. If real
client-facing logins are ever required, the smallest correct addition is a
`projects.ownerUserId` column (additive migration, existing rows defaulted
to a real owner) plus an ownership filter on every project/asset/work-map/
job/render route - not implemented, since nothing in this project's
requirements currently calls for separate client logins.

## Real Route Surface
The routes below are the actual, current surface (see `apps/api/src/routes/`)
- this replaces an earlier "recommended" sketch that had drifted from what
was actually built. Every route requires either a dashboard session
(`Authorization: Bearer <session token>`) or a worker's own bearer token,
never both, never neither:

```text
POST /api/auth/signup | /api/auth/login | /api/auth/logout
POST /api/workers/register                              (worker token pairing)
POST /api/workers/:workerId/heartbeat
POST /api/workers/:workerId/jobs/claim                   (worker)
POST /api/workers/:workerId/jobs/:jobId/report            (worker)
POST /api/workers/:workerId/jobs/:jobId/checkpoint        (worker)
POST /api/jobs                                            (dashboard - dispatch)
GET  /api/jobs                                            (dashboard - job history)
GET  /api/jobs/:jobId                                     (dashboard - one job's status/result)
POST /api/projects
GET  /api/projects | /api/projects/:projectId
POST /api/projects/:projectId/assets  (multipart)
GET  /api/projects/:projectId/work-map | PATCH ...
GET  /api/projects/:projectId/execution-plan
PATCH /api/projects/:projectId/execution-plan             (typed edit operations only)
POST /api/projects/:projectId/execution-plan/approve | /reject | /reopen
GET  /api/projects/:projectId/execution-plan/revisions
POST /api/projects/:projectId/mapping-suggestions/generate
POST /api/projects/:projectId/mapping-suggestions/:id/accept | /reject
POST /api/projects/:projectId/execution-sessions
POST /api/projects/:projectId/execution-sessions/:id/approve-preview | /reject-preview
GET  /api/projects/:projectId/render-artifacts
GET  /api/settings/ai-provider | POST /api/settings/ai-provider | /test
```

Job claiming is atomic (`SELECT ... FOR UPDATE SKIP LOCKED`, see
`drizzle-job-repository.ts`) - safe under real concurrent claims, no
external queue (Redis/BullMQ) needed at this scale.

## Bidirectional (RTL) text - generic rules

Writing direction is a property of the **text**, never of the template, the
layer name or the project. `packages/schemas/src/text-direction.ts` derives it
from Unicode alone and nothing else in the system is allowed to decide it.

- **Detection.** `analyseTextDirection(text)` matches every character against
  the RTL scripts listed in `RTL_SCRIPT_NAMES` through `Script_Extensions`
  (Hebrew, Arabic, Syriac, Thaana, N'Ko, Adlam and the rest), and counts any
  other letter as strongly left-to-right.
- **Base direction is first-strong**, the same rule the Unicode Bidirectional
  Algorithm uses to choose a paragraph's base direction (UAX #9, P2/P3): the
  FIRST strongly-directional character decides it. So `"מבית DYO App"` is a
  right-to-left paragraph, `"DYO App מבית"` is a left-to-right one, and
  leading digits, punctuation, quotes or whitespace never decide anything.
  Text with no strong character at all is NEUTRAL.
- **What is applied.** Whenever the text contains ANY right-to-left character
  (`requiresBidiHandling`), `SET_TEXT` sets that first-strong base direction -
  right-to-left for a Hebrew-first line, left-to-right for a Latin-first line
  that merely contains Hebrew - AND the Middle-Eastern-capable (universal)
  composer engine, which a Latin composer cannot substitute for whichever way
  the paragraph reads. Both are set on the same TextDocument as the text,
  **before** the auto-fit measures anything, because both change the rendered
  rect. Text with no right-to-left character never overrides the template's
  own direction or composer, whether it is LTR or NEUTRAL.
- **What is never done.** Characters are never reordered, mirrored or
  reversed. Visual ordering is After Effects' own bidi algorithm's job once
  direction and composer are right; reversing code points produces text that
  looks correct in one rendering and is wrong everywhere else.
- **Verification.** After writing, the stored text is read back and compared
  with the requested UTF-16 code units position by position, and for RTL text
  the direction and composer are read back and compared with what was
  requested.

### Failure behaviour

Every one of these fails the operation closed - the job reports a typed
failure and no later operation runs. A warning followed by an apparently
successful edit is never acceptable here, because the rendered result would
silently be wrong.

| Condition | Result |
| --- | --- |
| Text contains RTL characters, build exposes no `ParagraphDirection` | fails: "no paragraph-direction API" |
| Text contains RTL characters, build exposes no Middle-Eastern-capable `ComposerEngine` | fails: "no Middle-Eastern-capable composer engine" |
| Direction or composer assignment throws | fails, quoting AE's own error |
| Direction or composer not reported back after the write | fails, quoting the requested base direction and what was read back |
| Stored text differs from the requested code units | fails, naming the first differing code unit (or that the length differs) |

### Evidence

Each `SET_TEXT` operation reports a `textDirectionEvidence` entry on the job
result (`sceneEditResultSchema`): the base direction, which RTL scripts
occurred, whether the line is mixed, whether bidi handling was required, the
layer's previous direction/composer, what was applied, and the three
verification outcomes.

The operation's own `resultingValue` is unchanged by all of this - for
SET_TEXT it is still the stored text string it has always been, and the
evidence travels beside it as its own optional key, so nothing that already
reads `resultingValue` can be affected. The field defaults to
`[]`, so results written before this existed still parse; absence means "this
worker reported no direction evidence", never "the text was left-to-right".

## Leftover template copy - generic rules

A purchased template ships with its own wording. An approved plan that still
carries that wording renders a finished video that says what the template
said - the real 2026-09-18 incident, in which five of six visible text layers
shipped the template's copy with nothing unmapped and nothing failing.

### Capturing the template's own text

Template inspection records each text layer's own text, in full and exactly as
authored (no trimming, folding or normalisation), onto its manifest
placeholder as `originalText`. Three states are kept distinct, because they
mean different things:

| State | Meaning |
| --- | --- |
| a string | the complete text, captured and stored |
| `null` | captured, and this placeholder is not a text layer |
| key absent, with `originalTextVerification` | the text was longer than the 10,000-code-unit storage bound: `originalTextPreview` holds a display-only excerpt, and the digests describe the COMPLETE text |
| key absent, with no verification metadata | never captured - an older inspection. The only state that genuinely needs re-inspection |

### Text too long to store

A template text longer than the bound is still verified exactly. The worker
reads that one layer's text back in bounded slices, reassembles it in order,
checks the reassembled length against what After Effects reports, and computes
verification metadata from the COMPLETE string: its exact code-unit length and
four digests (exact, case-folded, whitespace-stripped, and both). The manifest
stores an excerpt plus that metadata, tied to the inspected source's own
sha256.

This replaced a rule that marked such a text "truncated" and blocked approval
with "re-run template inspection" - advice that could never work, because
re-inspecting truncates the same text again. The excerpt is never compared
with anything, and any UI showing it must label it as an excerpt.

The digest algorithm (`packages/schemas/src/text-digest.ts`) is one pure
TypeScript implementation shared by the worker, the API and the dashboard, so
a digest computed anywhere is byte-identical everywhere. It is pinned in tests
against `node:crypto` and `TextEncoder`. Whitespace is defined as an explicit
code-point set rather than a `\s` regex, and case folding is locale-independent,
so the digest path and the full-text path can never reach different verdicts.

### The gate

`assessTemplateCopy` (in `@dyo/schemas`, pure) compares a mapping's text with
its placeholder's `originalText`:

| Result | Blocks? |
| --- | --- |
| `IDENTICAL` - equal code point for code point | yes, until an explicit **Keep template text** decision |
| `TRIVIAL_VARIANT` - differs only in letter case, only in whitespace, or only in both | yes, until either explicit decision |
| `TEMPLATE_TEXT_UNKNOWN` - neither the text nor its digests are recorded | yes; the fix is re-running template inspection, and no decision can override it |
| `REPLACED` - genuinely different | no |
| `NOT_APPLICABLE` - no text on this mapping, or not a text placeholder | no |

Case folding and whitespace stripping are only ever used to RECOGNISE a
near-miss; equality itself is always exact code points, so text that merely
looks similar (a composed versus decomposed accent, say) is genuinely
different.

### Silence is never approval

Clearing the gate takes an explicit decision recorded on the mapping
(`keepTemplateText`), carrying the decision, who made it, when,
`textAtDecision` - the exact text it was made about - and
`textDigestAtDecision`, that complete text's canonical digest. Staleness is
judged by the digest whenever it is present, so a decision is never bound to
an abbreviated rendering of the text. If the text later changes, the decision
is **stale** and the mapping needs deciding again. A
`REPLACE` decision never unblocks text that is still identical: saying
"replaced" is not replacing.

Each mapping is judged on its own text, its own placeholder and its own
decision, so a template that repeats wording across scenes needs a decision
per occurrence - deciding one never clears another. Scenes not marked for use
are not judged at all.

### Where it is enforced

1. **Plan approval** (`approveExecutionPlan`) - refuses with the scene and
   layer named. Backend enforcement, so a direct API call cannot bypass it.
2. **Execution dispatch** (`resolveExecuteFrameDispatch`) - a plan approved
   before this gate existed still cannot execute template wording.
3. **Complete Preview** (`resolveCreateFullPreviewDispatch`) - a second,
   independent check against the current manifest and plan, immediately
   before a finished video is produced.

The dashboard's scene editor shows the template's own text beside the warning
and offers the two explicit choices, using the same pure function, so it can
never claim a plan is ready when the backend would refuse it.
