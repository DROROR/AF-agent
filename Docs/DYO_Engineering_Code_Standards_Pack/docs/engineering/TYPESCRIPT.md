# TypeScript Standard

Use strict compiler settings including:
- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `noImplicitReturns`
- `useUnknownInCatchVariables`

Rules:
- Prefer `unknown` over `any`.
- Narrow unknown values explicitly.
- Do not use non-null assertions to hide design problems.
- Prefer discriminated unions for state machines.
- Avoid TypeScript `enum`; prefer literal unions / `as const`.
- Avoid giant shared `types.ts` files.
- Do not expose ORM types directly through API contracts.

All untrusted boundaries require Zod:
- HTTP body/query/params
- worker messages
- environment variables
- execution plans
- template manifests
- persisted JSON blobs
- structured external process output
