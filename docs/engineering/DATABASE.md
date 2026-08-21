# Database Standard

Use PostgreSQL + Drizzle.

- Schema changes only through migrations.
- No manual production schema edits.
- Foreign keys for real relationships.
- Unique constraints for invariants.
- UTC timestamps.
- Prefer DB constraints plus application checks.
- Use transactions for job claim/assignment, state transitions/checkpoints and approval/plan activation.
- Use globally unique IDs consistently.
- Important changes record actor, time, previous state, new state and correlation/job ID.

Suggested core entities:
users, projects, templates, template_manifests, execution_plans, jobs, job_events, job_checkpoints, workers, assets, previews, renders, approvals.
