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

The digest algorithm (`packages/schemas/src/text-digest.ts`,
`sha256-utf16le-code-units-v1`) is one pure TypeScript implementation shared by
the worker, the API and the dashboard, so a digest computed anywhere is
byte-identical everywhere. It is pinned in tests against `node:crypto`.

**It hashes UTF-16 code units, not UTF-8.** After Effects and JavaScript both
hold text as UTF-16, and a UTF-16 string can contain an unpaired surrogate.
UTF-8 encoding maps every unpaired surrogate to U+FFFD, so a high lone
surrogate, a low lone surrogate and U+FFFD all hashed alike - a real collision
in a system whose job is exact verification. Encoding each code unit as two
little-endian bytes is injective over every possible JavaScript string, so
lone surrogates, valid pairs, U+FFFD, astral characters and composed versus
decomposed forms are all preserved distinctly.

Both normalizations are **context-free**, which is what lets them stream:
whitespace is an explicit code-point set rather than a `\s` regex, and case
folding is applied per code point rather than to the whole string. (Whole-string
lowercasing is context sensitive - a Greek capital sigma lowercases differently
at the end of a word - and a context-sensitive fold would give different
answers depending on where a slice boundary fell.) The same two functions serve
the full-text path, so the two paths can never reach different verdicts.

### How a long text is read

The worker reads the layer's text in bounded slices and **streams** each slice
straight into four incremental digests, never assembling the complete string.
A surrogate pair split across a slice boundary is carried inside the stream, so
the digests are identical however the text is sliced.

### Capture states, and why they differ

| `originalTextCaptureStatus` | Meaning | What an operator should do |
| --- | --- | --- |
| `COMPLETE` | the whole text is stored | nothing |
| `VERIFIED_EXCERPT` | too long to store, digests cover the complete text | nothing - it is fully verifiable |
| `CAPTURE_FAILED` | a transient read failure | re-run template inspection; it usually resolves |
| `TOO_LARGE` | beyond `MAX_VERIFIABLE_TEXT_CODE_UNITS` (2,000,000) | **terminal** - shorten the layer's text, or remove the mapping |
| absent | manifest predates text capture | re-run template inspection |

`TOO_LARGE` is reported as its own gate status
(`TEMPLATE_TEXT_TOO_LARGE_TO_VERIFY`) and is the one blocking state that
**cannot** be cleared with "keep template text": nothing was verified, so there
is nothing to keep. Telling an operator to re-inspect here would be an endless
loop, so the gate never does.

### The gate

`assessTemplateCopy` (in `@dyo/schemas`, pure) compares a mapping's text with
its placeholder's `originalText`:

| Result | Blocks? |
| --- | --- |
| `IDENTICAL` - equal code point for code point | yes, until an explicit **Keep template text** decision |
| `TRIVIAL_VARIANT` - differs only in letter case, only in whitespace, or only in both | yes, until either explicit decision |
| `TEMPLATE_TEXT_UNKNOWN` - neither the text nor its digests are recorded (or they were written under an older algorithm) | yes; the fix is re-running template inspection, and no decision can override it |
| `TEMPLATE_TEXT_CAPTURE_FAILED` - a transient read failure | yes; re-inspection usually resolves it |
| `TEMPLATE_TEXT_TOO_LARGE_TO_VERIFY` - beyond the verifiable size | yes, terminally; no decision and no re-inspection can clear it |
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

## Safe inspections - the disposable-project wrapper (Stage 3)

Every inspection that opens an After Effects project goes through ONE wrapper,
`apps/worker/src/inspection/disposable-project.ts`. The immutable source `.aep`
and a session working copy are never opened for inspection: a uniquely-named
disposable copy is, and it is disposed of afterwards.

**Why a copy.** Opening a project marks it modified in After Effects' memory,
leaves AE sitting on a file the next operation assumes is untouched, and makes
an accidental save catastrophic. That is precisely the 2026-09-18 incident: a
capability check left a session's approved working copy open and modified, and
something later wrote it to disk.

### What the wrapper does, in order

1. **Takes the project-state lock** (`project-state-lock.ts`). It refuses
   rather than queues - a queued inspection would act on a project state it
   sampled minutes earlier - and names what holds it.
2. **Hashes every protected file first**: the immutable source, and the session
   working copy when one is involved. "Unchanged afterwards" only means
   something if "before" was measured before anything was touched.
3. **Verifies the file to inspect** against its expected sha256.
4. **Proves the directory is writable** by creating and removing a real file in
   it, and refuses before After Effects is involved if it is not.
5. **Copies beside the original.** Template footage is routinely referenced by
   RELATIVE path; a copy in a scratch directory would resolve those against the
   wrong base and report missing footage the real project resolves. The copy
   is hashed and must equal its source exactly.
6. **Reads what After Effects already holds**, and refuses to touch it unless
   it can prove it is safe: a dirty project, an untitled/never-saved project,
   an unreadable state, or a build exposing no reliable `app.project.dirty`
   flag all stop the inspection. It never answers a Save Changes prompt and
   never discards unknown work.
7. **Opens the copy** - exactly one `app.open` attempt, never routed through
   transient retry (re-issuing it is the real 2026-09-03 incident). A timed-out
   open is resolved by read-only polling, never by a second open.
8. **Proves relative footage still resolves** in the copy, and fails closed
   rather than publishing evidence describing a project missing content the
   original has.
9. **Runs the inspection** against the copy.
10. **Re-hashes the protected files.** Any change is a safety violation and
    fails the inspection closed, whatever it returned.
11. **In `finally`, always**: closes the copy - only after proving the open
    project IS this operation's own copy - restores whatever After Effects held
    and verifies its identity, then removes the copy.

### Cleanup and quarantine

| Situation | Outcome |
| --- | --- |
| Copy closed and deleted | `DELETED` |
| Copy could not be proven closed | `LEFT_IN_PLACE_STILL_OPEN` - never deleted underneath a live handle |
| Delete failed | `QUARANTINED` - renamed to `<copy>.quarantine`, exact path reported |
| Delete and rename both failed | `CLEANUP_FAILED` - exact path reported for a human |

There is **no wildcard sweep**. `findStaleDisposableCopies` lists only files
matching this wrapper's own `.dyo-inspect-<uuid>.aep` marker, and only reports
them; nothing is ever deleted by pattern.

### Evidence

Every inspection reports a `safeInspection` record
(`disposableInspectionEvidenceSchema`): target path and expected/actual hashes,
the disposable copy's path and hash, source and working-copy hashes before and
after, the prior After Effects state, the restoration outcome, the cleanup
outcome, any unresolved footage, and timestamps. A refusal carries it too -
that is when an operator most needs to know how things were left.

### Coverage

| Path | Through the wrapper |
| --- | --- |
| `INSPECT_TEMPLATE` | yes |
| `INSPECT_SCENE_EVIDENCE` | yes |
| `INSPECT_RENDER_CAPABILITIES` | yes - and it now names the project to inspect; a request without one fails closed rather than reading whatever is open |
| `VERIFY_RENDER_COMPOSITION` (RENDER / CREATE_PREVIEW pre-check) | yes - verifies a hash-identical copy, so the artifact aerender renders is never opened |
| `RUN_DIAGNOSTIC`, `CHECK_HEALTH` | not applicable - they read logs, processes and health only, and open no project |

## Slot semantics and fit (Stage 4)

A template's image slots are not interchangeable. Some are DEVICE SCREENS - a
window cut into a rendered phone/laptop pass, usually animated in 3D - and some
are FLAT CARDS, decorative rectangles a designer drew. Dropping a logo into a
phone screen, or a full app screenshot into a small decorative card, produces a
video that renders perfectly and is completely wrong.

Three questions are asked of every mapping that places an asset, by the same
pure functions on both sides of the wire (`packages/schemas/src/slot-semantics.ts`
and `slot-readiness.ts`):

1. **What is this slot?** Classified from STRUCTURE only: nesting and host
   depth, track-matte presence AND what the matte is made of, 3D state, whether
   the host hangs off an animated parent, whether a pre-rendered beauty pass
   covers the same region, dimensions, aspect ratio and transformed bounds.
2. **Does this asset belong in it?** Judged from the declared role and measured
   facts - never a filename. `AssetFacts` has no filename field by construction.
3. **Will it actually look right?** The chosen fit (`contain` for a logo,
   `cover` otherwise - the same rule dispatch executes) is simulated: scale,
   coverage, crop, unused area and distortion.

### Names never decide

A layer called "Phone Screen" is weak supporting evidence and nothing more. The
winning side and the confidence are computed from `structuralDevice`/
`structuralFlat` - sums that contain no name-derived term. Name evidence is
collected separately, shown to a human, and never added to those sums. A test
flips every name in a fixture and asserts the classification and confidence are
unchanged.

### Confidence, and what happens when it is low

`confidence = margin x mass`, versioned by `SLOT_SEMANTICS_MODEL_VERSION`.
Evidence on BOTH sides above `CONFLICT_EVIDENCE_THRESHOLD` makes the verdict
`conflicting`, which caps confidence below the threshold. Below
`SLOT_CONFIDENCE_THRESHOLD`, unknown, or conflicting, the verdict
`requiresHumanDecision` - and that BLOCKS plan approval, execution dispatch and
the complete-preview gate. It is never a warning.

### Which placeholders are judged

Only visual slots: `image`, `video`, `logo`, `phone_screen`. A text line or a
colour swatch is not a window into anything, so an asset attached to one is not
judged here. `build-manifest.ts` and the readiness gate use the same rule, so a
placeholder that gets no slot facts is never blocked waiting for a verdict that
could not exist.

### The evidence frame is mandatory

Every low-confidence classification, compatibility conflict and unsafe fit
requires a real captured frame before a decision can be recorded. The moment
comes from EFFECTIVE visibility (`computeEffectiveVisibility`), not from timing:
a host is considered only when it is enabled, its rendered rectangle reaches its
composition's frame, and its opacity stays above `MIN_VISIBLE_OPACITY_PERCENT`
across the window; the longest such window wins and the frame is taken at its
midpoint. A fact that is unread never disqualifies a host - unknown is not
false - but a fact that is KNOWN to hide it does, and a slot that no host
presents visibly has no provable moment at all. It is never the first frame of a
layer, which is routinely mid-transition, and never a timestamp the browser
chose: the dashboard names the MAPPING
(`slotEvidenceMappingId`) and the server resolves the moment from that slot's
structural facts, the same way every other addressing fact is server-resolved.
Capture runs through the Stage 3 disposable-project wrapper like every other
inspection.

The API verifies the frame rather than trusting it: it must be this scene's most
recent captured frame, from the source the plan is bound to, with a recorded
capture moment inside the slot's visible window. A slot that never presents a
provable visible moment cannot be decided at all - that is reported plainly
instead of capturing a frame that shows nothing.

### Decisions go stale

A recorded decision carries a digest of exactly what was blocking
(`slotEvidenceDigest`). A new, removed or changed finding produces a different
digest, which makes the old decision stale rather than letting it silently cover
something the reviewer never saw - the same rule as the leftover-template-copy
gate, for the same reason.

### Fingerprints fail closed at mutation time

Each slot carries a versioned structural fingerprint and a narrower mutation
fingerprint over the exact chain an edit traverses plus the slot's own geometry.
Immediately before any `MAP_FOOTAGE`, the worker re-reads the live chain
(`describeChainStructure`) and recomputes that digest. A layer inserted, a host
reparented, a matte changed, a slot resized - anything that moves the structure -
fails the operation closed. A slot in the scene's own composition is checked as a
one-hop chain, not skipped.

### Assets are measured, never assumed - and an alpha channel is not transparency

Dimensions, transparency and visible content come from the uploaded bytes
(`apps/api/src/domain/asset/probe-image-facts.ts`). PNG is genuinely DECODED -
every non-interlaced colour type and bit depth, including palette transparency -
so the facts are about pixels, not about the container:

- `hasAlphaChannel` - what the file CAN carry. Evidence, never a verdict. A
  screenshot exported as RGBA sets it; so does a palette image declaring a
  transparent colour it never uses.
- `hasTransparentPixels` / `transparentPixelRatio` - what the picture actually
  contains. NULL means the pixels could not be decoded (a WebP declaring alpha,
  a video, an upload predating measurement), which the gate treats as UNKNOWN -
  a human confirms it, and it is never read as either opaque or transparent.
- `visibleContentBounds` / `visibleCoverageRatio` - where the non-transparent
  content actually sits, so a logo with wide transparent padding is not mistaken
  for an image that fills its slot.

Transparency below `SIGNIFICANT_TRANSPARENCY_RATIO` is incidental - an
antialiased corner is not a see-through background - and does not block. The fit
check uses the measured content too: coverage and crop are computed from the
visible content when it is known, so cropping empty padding costs nothing and a
mostly-padding asset is flagged (`LARGE_TRANSPARENT_PADDING`) even though its
file fills the slot.

JPEG and plain lossy WebP cannot encode transparency at all, so their opacity is
a fact of the format rather than a decode. Video, audio and documents stay
unmeasured, and unmeasured dimensions block.
