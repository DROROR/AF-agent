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
