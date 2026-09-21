# Logging & Observability

Use structured production logs.

Include when available:
- requestId
- jobId
- workerId
- projectId
- operation
- jobStatus

Never log secrets.

Required events include:
worker registered, online/offline, heartbeat missed/recovered, job queued/claimed/started, state transition, checkpoint created, MCP disconnect/reconnect, AE offline/online, suspected modal, preview created, render started/completed/failed, job completed/failed.

Provide API liveness/readiness and DB readiness. Readiness must not be green when required dependencies are unavailable.

## Safe inspections (Stage 3)

Every inspection that opens an After Effects project reports a `safeInspection`
evidence record on its own job result - see `docs/ARCHITECTURE.md` and
`disposable-inspection.ts`. It is durable, per-job evidence, not a log line, and
it is present on refusals as well as successes.

Always recorded:

- `targetPath`, `targetExpectedSha256`, `targetActualSha256`
- `disposablePath`, `disposableSha256`
- `sourceSha256Before` / `sourceSha256After`, and the working-copy pair when one
  is involved (any difference is a safety violation, and fails the job)
- `priorAeProjectState` (open? path, name, item count, dirty flag)
- `restoration` and `restorationNote`
- `cleanup` and `cleanupNote`
- `unresolvedFootage`

Worker log events (structured, with the disposable path):

- could not close the disposable copy - it is left on disk rather than deleted
  underneath After Effects
- could not restore the project After Effects held before the inspection
- disposable copy cleanup did not complete (quarantined, or failed)

These three are the only states that leave a file behind, and each names the
exact path an operator must deal with. Nothing is ever deleted by pattern.

## Slot decisions (Stage 4)

Every recorded slot decision is auditable on the plan revision itself
(`mapping.slotReview`):

- `decision` (`ACCEPT` / `OVERRIDE_CLASSIFICATION`) and, for an override, the
  `classification` the reviewer asserts
- `decidedBy` and `decidedAt` - an unattributable decision is refused, never
  recorded anonymously
- `evidenceDigest` - the exact findings the decision was made about, so a later
  change makes it stale instead of silently carrying over
- `evidenceFrameStorageKey` - the frame the reviewer was shown, verified against
  the scene's real captured frame, its source sha256 and its capture moment

The manifest carries the reasoning behind each verdict: `slotSemantics`
(classification, confidence, conflicting, positive and negative evidence, and a
plain-words reason when it requires a decision) and `slotFacts` (the structure
it was derived from). Nothing is re-derived at read time, so an old plan can
always be explained with the facts it was actually judged on.

Captured evidence frames record `capturedAtSeconds` - WHERE in the composition's
own timeline they show. A frame without it cannot back a slot decision, because
nothing proves what it shows.

## Measured asset facts (Stage 4 follow-up)

Each asset row records HOW its transparency was established, not just the
answer: `pixel_analysis` is `DECODED` (pixels were read and counted),
`NO_ALPHA_CHANNEL` (the format cannot encode transparency, so opacity is
certain without decoding) or `NOT_DECODED` (unknown - never an assumption).
Alongside it, `has_alpha_channel` records the container's capability separately
from `has_transparent_pixels` / `transparent_pixel_ratio`, and
`visible_coverage_ratio` / `visible_content_bounds` record where the visible
content actually sits.

Reading a blocked mapping back therefore always answers "why was this blocked,
and on what evidence" - including the case where the honest answer is that the
pixels could not be read.
