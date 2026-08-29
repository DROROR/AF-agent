# Examples

Real, schema-validated sample payloads for onboarding/documentation - each
file here is checked against the actual `@dyo/schemas` definitions (not
hand-typed guesses). These are illustrative shapes, not a client to run
them with; use the real dashboard or `docs/ARCHITECTURE.md`'s route list
for actual usage.

- `jobs/dispatch-inspect-template.json` - `POST /api/jobs` body to dispatch
  a real INSPECT_TEMPLATE job (dashboard session required).
- `jobs/dispatch-execute-frame.json` - `POST /api/jobs` body to dispatch a
  real EXECUTE_FRAME job. Note this is deliberately minimal: the server
  resolves the actual composition/operations from the approved execution
  plan itself (see `resolve-execute-frame-dispatch.ts`) - the browser never
  supplies that payload directly.
- `work-map/sample-work-map.json` - a `WorkMap` shape (`PUT
  /api/projects/:projectId/work-map`) showing both a text entry and an
  asset+timestamp entry.

To re-validate these against the real schemas after a schema change, parse
each file with the matching Zod schema from `@dyo/schemas` (e.g.
`dispatchJobRequestSchema.safeParse(...)`, `workMapSchema.safeParse(...)`)
from a script run at the repo root.
