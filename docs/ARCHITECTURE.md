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

## Recommended API Skeleton
Possible routes (exact naming may evolve):

```text
POST /api/workers/register
POST /api/workers/heartbeat
POST /api/workers/:id/claim-job
POST /api/jobs
GET  /api/jobs/:id
POST /api/jobs/:id/checkpoints
POST /api/jobs/:id/artifacts
POST /api/jobs/:id/approve-mapping
POST /api/jobs/:id/approve-style
POST /api/jobs/:id/approve-branding
POST /api/jobs/:id/approve-final
```

Use atomic/transactional job claiming.
