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
