# DYO After Effects Video Agent

A deterministic After Effects automation system: it reads Envato AE
templates, discovers scenes/placeholders, produces a human-approval
production table, then safely generates branded landscape and native
1080x1920 Reels videos from the approved plan. It is **not** a generic AI
video generator - see `CLAUDE.md` (root) for the full architecture,
safety rules, and permanent brand rules that govern every change to this
repo.

## What's here
- `apps/api` - Fastify control-plane API (auth, projects, jobs, worker
  registry, approvals).
- `apps/web` - Next.js dashboard (the operator's control room).
- `apps/worker` - the native Windows Worker that talks to After Effects via
  `ae-mcp` and runs `aerender`.
- `packages/schemas` - the single Zod source of truth every layer imports.
- `packages/database` - Drizzle ORM schema/migrations (PostgreSQL).
- `dyo-brand-rules.yaml` - the permanent DYO brand-rule configuration
  (logo/Hebrew text/brand color), enforced at plan-approval time.

## First-time setup
```bash
npm ci
cp .env.example .env        # fill in real values - never commit .env
npm --workspace @dyo/database run db:migrate
npm run build
npm test
```

`docker-compose.yml` (repo root) runs Postgres/API/web locally. The Windows
Worker is native (not containerized) - see `docs/WINDOWS-WORKER.md`.

## Day-to-day
- `npm run lint` / `npm run typecheck` / `npm test` - run before every
  commit (see `docs/engineering/TESTING.md`).
- `npm run build` - full solution build; **never** build the web app inside
  the live production checkout (see `docs/RUNBOOK.md`) - use an isolated
  git worktree instead.
- `npm run package:windows-worker` - assembles the Windows Worker update
  package (see `docs/WINDOWS-WORKER.md`).

## Where to go next
| Need | Doc |
|---|---|
| Operating the system day-to-day, troubleshooting, backup/recovery | `docs/HANDOVER.md` |
| Start order, job execution flow, real MCP/AE failure model | `docs/RUNBOOK.md` |
| Full architecture, real route surface, security model | `docs/ARCHITECTURE.md` |
| Original phased build plan (historical - see its own staleness notes) | `docs/MASTER_PLAN.md`, `docs/PHASES.md` |
| MVP acceptance criteria and their current status | `docs/ACCEPTANCE.md` |
| Windows Worker install/update | `docs/WINDOWS-WORKER.md`, `docs/CLIENT_WORKER_PREFLIGHT.md` |
| Schema reference | `docs/SCHEMAS.md` |
| Engineering standards (testing, security, code style) | `docs/engineering/` |
