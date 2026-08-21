# Claude Code Implementation Rules

## Before coding
1. Read `CLAUDE.md`, `ENGINEERING.md`, and relevant engineering docs.
2. Inspect existing code before creating abstractions.
3. State phase goal and planned files.
4. Do not redesign locked architecture without a demonstrated blocker.

## During coding
- Work in small vertical slices.
- Prefer runnable production code over fake scaffolding.
- Keep routes thin.
- Put business logic in application/domain modules.
- Validate every external input.
- Add tests for behavior.
- Avoid critical-path TODO placeholders.
- Do not add packages without explaining why.
- Do not modify unrelated files.
- Do not use `any` to silence TypeScript.
- Never execute arbitrary shell/PowerShell/JSX from API input.
- Never modify original `.aep` files.

## After coding
Run where available:
```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Report:
1. What was implemented.
2. Files created/changed.
3. Checks/tests and results.
4. Database/env changes.
5. Known limitations.
6. Exact next task.

Never claim success if checks were not run. Never hide failing checks.
