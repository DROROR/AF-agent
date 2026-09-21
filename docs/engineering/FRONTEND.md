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

## Blocking findings are shown with their evidence (Stages 2 and 4)

The scene editor never asks for a decision the backend would refuse:

- It computes the leftover-template-copy assessment and the slot findings with
  the SAME pure functions from `@dyo/schemas` that the API gate runs, against
  the form's current state (including an asset just picked but not yet saved).
- A slot decision requires a real captured frame of the moment the slot is on
  screen. Until one exists and shows that moment, the decision buttons stay
  disabled and the panel says which of the two is missing.
- The capture request names the MAPPING, never a timestamp - the server resolves
  the moment from the slot's own structural facts.
- Decision operations are emitted LAST for their mapping, after any text or
  asset change in the same request, so the findings the API binds the decision
  to are the ones that request produces.
