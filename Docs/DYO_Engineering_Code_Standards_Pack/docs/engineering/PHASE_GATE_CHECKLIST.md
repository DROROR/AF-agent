# Phase Gate Checklist

Before moving to the next phase:

## Engineering
- [ ] Current phase acceptance criteria met.
- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Tests pass.
- [ ] Build passes where applicable.
- [ ] No critical TODOs in delivered path.
- [ ] No secrets/generated large artifacts committed.

## Architecture
- [ ] No cross-layer shortcut.
- [ ] Contracts/schemas versioned when needed.
- [ ] Multi-worker capability preserved.
- [ ] Worker remains outbound-only.
- [ ] AE operation allowlist preserved.

## Reliability
- [ ] Retry behavior bounded.
- [ ] State transitions persisted.
- [ ] Checkpoint/recovery considered.
- [ ] Failure logs include job/worker IDs.

## Documentation
- [ ] README/docs updated.
- [ ] `.env.example` updated if needed.
- [ ] Migration notes included if needed.

Only then start the next phase.
