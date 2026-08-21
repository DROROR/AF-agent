# Git & Code Review Standard

Protect `main`.

Use focused branches:
- `feat/worker-heartbeat`
- `feat/template-inspector`
- `fix/job-recovery`
- `chore/tooling`

Prefer small coherent commits:
- `feat(api): add worker registration endpoint`
- `feat(worker): send authenticated heartbeat`
- `test(jobs): cover invalid state transition`
- `fix(ae): stop retry loop on heartbeat loss`

PRs should state:
- what changed
- why
- architecture impact
- tests run
- migration/env changes
- screenshots for dashboard changes
- known limitations

Senior review asks:
- Is behavior correct?
- Is design simpler than alternatives?
- Are boundaries respected?
- Are failures handled?
- Are inputs validated?
- Is code testable?
- Are tests meaningful?
- Are logs sufficient?
- Is security affected?
- Can this be rolled back?
