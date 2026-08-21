# Code Standards

## Naming
- Files: `kebab-case.ts`
- React components: `PascalCase.tsx`
- Functions/variables: `camelCase`
- Types/interfaces/classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE` only for true constants
- Database tables/columns: `snake_case`
- Environment variables: `UPPER_SNAKE_CASE`

Names must describe intent. Avoid vague names like `data`, `obj`, `tmp`, `thing`.

## Functions and modules
- One conceptual job per function/module.
- Prefer early returns over deep nesting.
- Avoid boolean parameter traps; use options objects or dedicated functions.
- Do not use exceptions for normal control flow.
- Do not swallow errors.
- Keep routes/controllers thin.
- Business logic belongs in application/domain modules.
- Infrastructure must not leak into domain logic.

Recommended dependency direction:

`route/controller -> application service/use case -> domain rules -> repository/adapter`

## Comments
Comments explain **why**, not obvious **what**.

## Duplication
Do not duplicate job status rules, DYO branding rules, worker capability checks, path validation, error mapping, environment parsing, or execution-plan validation.

## Dead code
No commented-out production code, unused exports, stale flags, or abandoned experiments on `main`.
