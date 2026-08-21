# DYO Video Agent — Engineering Standard

This repository is production software. Code should read like work from a mature engineering team, not a prototype.

## Non-negotiable principles
1. Correctness before cleverness.
2. Explicit behavior over magic.
3. Small focused modules.
4. Strong typing at every boundary.
5. Deterministic operations for After Effects automation.
6. No silent failures.
7. No hidden global state.
8. No duplicated business rules.
9. No production secrets in source control.
10. Every meaningful change must be testable and observable.

## Required quality bar
- TypeScript strict mode.
- No `any` unless isolated, documented and unavoidable.
- Public functions have explicit input/output types.
- External input is validated with Zod before use.
- Business logic is separated from HTTP/database/process concerns.
- Errors use typed/application error classes.
- Logs are structured and include correlation/job/worker IDs where relevant.
- Database migrations are committed.
- New behavior includes tests.
- No direct mutation of original `.aep` files.
- After Effects operations must be deterministic and recoverable.
- One AE job per worker initially.
- Every job transition is persisted before/after risky external work.

Read every file under `docs/engineering/` before implementing a phase.
