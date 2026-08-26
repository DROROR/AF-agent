# Production Safety Standard

`/opt/AF-agent` on the Contabo host is the real, live production checkout - not a
sandbox, not a separate "local" copy. `deploy-production.sh` deploys directly
into this exact directory, and `dyo-api`/`dyo-web` are the real PM2-managed
processes serving real client traffic on this same box. Anyone (human or
agent) operating in this directory is operating on production.

## The 2026-08-26 incident

A manually-launched `tsx apps/api/src/index.ts` process, started outside PM2
to "smoke test locally," bound port 4000 and was never torn down. Every
subsequent legitimate deploy's `pm2 startOrReload` then failed to bind that
same port (`EADDRINUSE`) and crash-looped invisibly in the background, while
the stale manual process kept answering `curl`/PM2-status checks and real
traffic with old code. The deploy's own health check reported success
because *something* answered on port 4000 - it was just the wrong something.
As a direct result, a live verification call against the real API hit the
stale process and incorrectly approved a real customer's unresolved
execution plan. See `production-runtime-guard.ts` and
`scripts/lib/deploy-health-check.sh`'s port-ownership functions for the
resulting hardening.

## Rules

**Never run a manual `tsx`/`node`/`nohup` copy of `apps/api` (or anything
else that binds a well-known production port) directly on this host.**
Use `pm2 startOrReload deploy/pm2/ecosystem.config.cjs --only dyo-api` (or
the full `scripts/deploy-production.sh` pipeline) - never a bare shell
command. If `NODE_ENV=production` is set, `apps/api` now refuses to start
outside PM2 by itself (see `production-runtime-guard.ts`) - do not work
around that refusal by setting `ALLOW_UNMANAGED_PRODUCTION_START` unless a
human has explicitly asked for a genuine one-off diagnostic run and
understands the risk.

**Never smoke-test a mutating/edit flow against the real White App Promo
project (or any other real client project).** Approve, reject, reopen,
include/exclude, reorder, and field-edit operations all mutate real,
durable state. Verifying that such a flow *works* requires a disposable
project and account - see "Disposable projects for smoke testing" below.

**Real-project checks are read-only unless a human has explicitly approved
a specific mutation.** `GET` requests against real projects/plans are
always fine. A `POST`/`PATCH` against a real project's execution plan is
not a "quick check" - treat it with the same care as any other production
write.

**Before binding a port or starting a background process on this host,
check what's already there.** `pm2 list` and `ss -ltnp` take a few
seconds and would have caught the 2026-08-26 incident immediately. Do not
assume a directory is an isolated sandbox because of its name or because a
task frames it as "local" - verify (e.g. by checking whether
`deploy-production.sh`'s own `APP_DIR` matches the directory you're in).

## Disposable projects for smoke testing

Create a throwaway account via the real `/api/auth/signup` endpoint and a
throwaway project via the real `POST /api/projects` endpoint (proxied by
the dashboard at `apps/web/src/app/api/projects/route.ts` - never a raw
`psql` insert). Exercise whatever mutation needs verifying against that
disposable project only. Delete the throwaway account and project
afterward. Never reuse a disposable project's data as if it were a real
one, and never mutate a real project "just to check something works."
