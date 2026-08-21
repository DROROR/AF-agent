# Architecture Rules

## Locked boundaries

### Control plane — Contabo
- Next.js dashboard
- Fastify API
- PostgreSQL
- job scheduling/state
- approvals
- logs/metadata
- worker registry

### Execution plane — Windows workers
- DYO Worker
- After Effects 2026
- ae-mcp bridge
- deterministic JSX/ExtendScript
- FFmpeg/FFprobe
- aerender

Workers connect outbound to the API. No production dependency on RDP/AnyDesk.

## Multi-worker from day one
Backend models workers independently:
- worker_id
- status
- capabilities
- AE version
- max concurrency
- current job
- last heartbeat

Do not hard-code one worker or one client. Initial `maxConcurrency = 1`.

## Job state machine
Transitions must be explicit and validated. Persist state changes before/after risky external work.

## Deterministic AE automation
AI may suggest decisions, but deterministic code executes paths, timing, frame extraction, scene selection, project duplication, render commands and validation.

Never execute arbitrary model-generated shell/PowerShell/JSX in production.

## Original file protection
The original `.aep` is immutable:
- calculate/store hash
- copy to job workspace
- operate only on copy
- verify original hash during acceptance
