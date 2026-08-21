# Dashboard Frontend Standard

Use Next.js + React + TypeScript.

- Keep components focused.
- Separate server state from UI state.
- Do not fetch deep inside random presentational components.
- Shared domain contracts come from versioned schemas, not copied interfaces.
- Validate forms on client and server.
- Deliberately handle loading, empty, error and disabled states.
- Use semantic accessible controls.

Create reusable components for:
- status badge
- worker card
- job state timeline
- approval actions
- error/alert panel
- scene/placeholder table

Centralize status labels/presentation instead of duplicating them.
