# Template Inspector (Phase 5 preparation)

Status: **contracts and deterministic classification logic only.** No real
AE inspection has run. This document exists so that once the real Windows
Worker is online (Phase 4, still pending), the first read-only inspection
can start immediately instead of being designed from scratch.

## What exists today

- `packages/schemas/src/template-manifest.ts` - the `template-manifest.json`
  schema (Zod), following the illustrative shape in `docs/SCHEMAS.md`,
  extended to the field-by-field detail this phase requires.
- `packages/schemas/src/inspect-template.ts` - the `INSPECT_TEMPLATE`
  request/response contract. `INSPECT_TEMPLATE` is already a recognized
  entry in `WORKER_CAPABILITIES` (`packages/schemas/src/worker.ts`), from
  Phase 2 - this just gives it a real request/response shape.
- `apps/worker/src/inspection/` - deterministic, pure, fully-tested logic
  that transforms already-extracted structural facts about an AE project
  into a schema-valid manifest:
  - `project-facts.ts` - the generic structural input shape (composition/
    layer/footage facts) a real executor would eventually produce.
  - `classify-placeholder.ts` - pure classification from structural facts
    to a `PlaceholderType`.
  - `deterministic-id.ts` - stable, structure-based ID generation.
  - `build-manifest.ts` - assembles `ProjectFacts` into a `TemplateManifest`.
  - `format-manifest-summary.ts` - the human-readable summary.
  - `allowed-inspection-queries.ts` - the closed allowlist of read-only AE
    ExtendScript object-model members inspection may ever query.
  - `template-inspector.ts` - the `TemplateInspector` service interface,
    plus `NotAvailableTemplateInspector`, an honest stub that always throws
    `InspectionTransportUnavailableError` rather than fabricating a result
    (same pattern as `AfterEffectsRenderer` in `packages/renderer` and
    `NotIntegratedMcpAdapter` in `apps/worker/src/health/mcp-adapter.ts`).

None of this executes against real After Effects. All of it is testable,
and tested, without one.

## Why "logo" and "phone_screen" are never auto-assigned

`classifyPlaceholder` only assigns `text`/`video`/`image`/`color` when AE's
own object model makes the answer unambiguous (a `TextLayer` *is* text;
footage with `hasVideo=true` *is* video). Nothing in AE's structure says "this
image is a logo" or "this layer is a phone screen" - those are
template-specific semantic roles, not structural facts. Guessing them from a
layer name (e.g. treating a layer called "Phone_L" as "Left Phone") would be
exactly the kind of invented label this project's instructions forbid.
`logo`/`phone_screen` stay `unknown` from automated inspection; assigning
them is a human/approval-stage decision (`execution-plan.json`), not
something this module does.

The same discipline applies to `displayName`/`displayLabel` on scenes and
placeholders (present in the schema, matching `docs/SCHEMAS.md`'s
illustrative "Left Phone"/"Scene 05" examples) - nothing in this codebase
ever fills them in. They stay `null` until a human assigns them.

## The transport blocker (why nothing executes yet)

`INSPECT_TEMPLATE` cannot actually run today, for two separate, both
real, reasons:

1. **No job-dispatch mechanism exists between the API and the worker.**
   The worker's only communication with the API today is the heartbeat
   loop (`apps/worker/src/runtime/heartbeat-loop.ts`) - there is no
   endpoint for the API to hand a job to a worker, and no polling/command
   loop on the worker side to receive one. `CURRENT_WORKER_CAPABILITIES`
   (`apps/worker/src/domain/operation-allowlist.ts`) is still just
   `["CHECK_HEALTH"]`. Building that dispatch mechanism is a separate,
   larger piece of work, not started.
2. **ae-mcp's real bridge/command protocol is still unknown.** Phase 4
   confirmed the shape of `instance.json` (ae-mcp's state file) from a real
   client sample, but never confirmed how to actually *send* it a command
   and get a structured result back. `allowed-inspection-queries.ts` lists
   real, standard, publicly-documented After Effects ExtendScript API
   members - that's a legitimate, non-invented allowlist - but the actual
   wire protocol for asking ae-mcp to run one is not known, and inventing
   it would violate this project's "never fabricate" rule.

`NotAvailableTemplateInspector` exists specifically so that once both of
these are resolved, only the executor itself needs to be written - the
contracts, classification logic, ID stability, and safety tests are already
done and do not need to change.

## Read-only guarantees

- Never saves the `.aep` (CLAUDE.md Safety Rule 1).
- Never modifies layers or project state - `allowed-inspection-queries.ts`
  is a closed list of property *reads* and non-mutating enumeration; no
  entry is a setter, and a test statically asserts none of them match a
  mutating-verb pattern (`.save(`, `.remove(`, `.setValue(`, etc.).
- Never renders.
- Never executes arbitrary JSX - a test statically scans every source file
  in `apps/worker/src/inspection/` for `eval(`, `new Function(`,
  `child_process`, `exec(`/`execFile(` and fails if any appear.

## First real client-machine test plan

Only attempt this once **all** of the following are true - do not skip
ahead:

1. **Worker ONLINE** - the real Windows Worker (`deploy/windows-worker/`)
   is registered and heartbeating against `https://worker-api.dyocourses.com`.
2. **AE ONLINE** - `aeStatus` reports `ONLINE` in a real heartbeat (After
   Effects is actually running on the client machine).
3. **MCP ONLINE** - `mcpStatus` reports `ONLINE` via the real
   `McpInstanceFileAdapter` freshness logic (not `UNKNOWN`, not assumed).
4. **Open a COPY of one approved test project** - never the original. Use
   one of the known-good POC projects already documented
   (`docs/CLIENT_WORKER_PREFLIGHT.md`): `Working-2026`, `Production-v01`,
   `Color-Type-Test-v01`, or `Tanach-Israeli-Reels-F02-Test-v02`. Never
   `Tanach-Israeli-Vertical-Test-v01` (explicitly rejected). Copy first,
   even though the inspector is designed to be read-only - a real bridge
   connection is new, unverified territory, and a copy costs nothing.
5. **Run `INSPECT_TEMPLATE` only** - no other operation, no render, no
   branding, nothing else in the same session.
6. **Compare the generated `template-manifest.json` against the actual AE
   project structure by hand** - composition list, scene order, layer
   names/indexes, placeholder types, fonts/footage/plugins found. Every
   discrepancy gets written down, not silently accepted.
7. **Confirm no save, no mutation** - re-hash the copy's `.aep` after the
   run and diff it against its hash from before the run. They must match
   exactly (mirrors the original-`.aep` hash-verification discipline from
   the Phase 0/4 preflight work).
8. **Human approval** - a person reviews the manifest and the diff-against-
   structure comparison before this is ever considered validated. This
   document, and the code it describes, do not constitute that approval.

Do not run `INSPECT_TEMPLATE` against a client's real production `.aep`
until this checklist has passed once on a copy of an approved test project.
