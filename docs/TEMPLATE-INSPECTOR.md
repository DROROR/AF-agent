# Template Inspector (Phase 5)

Status (2026-08-25): **real read-only transport wired, no real inspection
run yet.** Phase 4 (real Windows Worker + AE/ae-mcp integration) is
complete - see `docs/AUDIT.md`. `HeroicSwanTemplateInspector`
(`apps/worker/src/inspection/heroic-swan-template-inspector.ts`) has
replaced `NotAvailableTemplateInspector` in the real worker execution path
and is gated on AE/MCP confirmed `ONLINE` (see "The transport blocker"
below, now resolved, and job-dispatcher.ts's safety gate). No job has been
dispatched to the real client machine yet - the checklist below still
applies before that first attempt.

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
    the `RawInspectionCapture`/`ManifestInspectionResult` result union, and
    `NotAvailableTemplateInspector`, an honest stub that always throws
    `InspectionTransportUnavailableError` rather than fabricating a result
    (same pattern as `AfterEffectsRenderer` in `packages/renderer`) - no
    longer used in the real worker execution path (see below), kept as a
    minimal reference implementation and for tests that need a
    guaranteed-unavailable inspector without depending on ae-mcp at all.
  - `heroic-swan-template-inspector.ts` - `HeroicSwanTemplateInspector`,
    the real implementation now wired into the real worker execution path
    (`index.ts`). Calls exactly the four zero-argument allowlisted
    read-only MCP tools (`ae_health`, `ae_list_instances`,
    `ae_get_project_info`, `ae_list_compositions`) via
    `heroic-swan-mcp-client.ts` and returns a `RawInspectionCapture` - the
    real response shapes for these tools are not confirmed yet, so this
    captures what they actually return (bounded in size, never guessed at)
    rather than forcing it into a `TemplateManifest` field mapping.
    `ae_get_composition` remains allowlisted/reachable but is not called
    this pass - it needs a real composition identifier from
    `ae_list_compositions`' own response, which this capture exists to
    discover safely. `ae_run_jsx` and every other upstream tool
    (`src/mcp/tools/index.ts` in the real ae-mcp repository registers many
    more - a Blender bridge, transcription, workflow audits, etc.) are
    unreachable through this path by construction (a closed TypeScript
    union, not a runtime check).

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

## The transport blocker (resolved 2026-08-25)

`INSPECT_TEMPLATE` could not run for two separate, both real, reasons -
both now resolved:

1. **No job-dispatch mechanism existed between the API and the worker.**
   Resolved: `POST /api/workers/:workerId/jobs/claim` and
   `POST /api/workers/:workerId/jobs/:jobId/report`, plus
   `apps/worker/src/runtime/job-cycle.ts` (one bounded claim/execute/report
   attempt per successful heartbeat), are built, tested, and live at
   `worker-api.dyocourses.com`. `CURRENT_WORKER_CAPABILITIES`
   (`apps/worker/src/domain/operation-allowlist.ts`) now includes
   `INSPECT_TEMPLATE`. No job has actually been dispatched to the real
   client worker yet - the mechanism is proven, the real end-to-end
   attempt has not happened.
2. **ae-mcp's real bridge/command protocol was unknown.** Resolved: the
   real, official, public protocol is the Model Context Protocol itself
   (confirmed directly from the real upstream HeroicSwan/after-effects-mcp
   repository's `package.json`/`src/index.ts`/`src/mcp/tools/index.ts`,
   not invented) - `node <AE_MCP_PATH>/dist/index.js serve` speaks real MCP
   over stdio, and `heroic-swan-mcp-client.ts` is a real client built on
   the official `@modelcontextprotocol/sdk`. `allowed-inspection-queries.ts`
   (the ExtendScript object-model allowlist for a *direct* JSX-based
   executor) is superseded by this MCP-tool-based approach for now - ae-mcp
   itself exposes the read-only tools, so this worker never needs to send
   raw ExtendScript at all for INSPECT_TEMPLATE.

`NotAvailableTemplateInspector` is no longer used in the real worker
execution path (`HeroicSwanTemplateInspector` replaced it in `index.ts`) -
kept as a minimal reference implementation of the interface.

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
   **Confirmed 2026-08-25** - see `docs/AUDIT.md`.
2. **AE ONLINE** - `aeStatus` reports `ONLINE` in a real heartbeat (After
   Effects is actually running on the client machine). **Confirmed
   2026-08-25.**
3. **MCP ONLINE** - `mcpStatus` reports `ONLINE` via the real
   `HeroicSwanMcpAdapter` (ae-mcp's own official `health` CLI command, not
   `UNKNOWN`, not assumed). **Confirmed 2026-08-25.** These three are also
   re-checked automatically, live, immediately before every real
   `INSPECT_TEMPLATE` attempt (job-dispatcher.ts's safety gate) - not just
   a one-time precondition.
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
