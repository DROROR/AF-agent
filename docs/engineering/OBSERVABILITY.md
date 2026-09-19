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
