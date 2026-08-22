# Renderer Architecture (Shotstack POC)

**Status: experimental, isolated, not wired into any production path.**
This document describes `packages/renderer`, built while Phase 4's real
Windows/After Effects work is paused (client machine temporarily
unavailable — see `docs/AUDIT.md`). It does not change the locked
architecture in `CLAUDE.md`: After Effects (via `apps/worker` + ae-mcp +
`aerender`) remains the supported production renderer. Nothing here
replaces, deletes, or rewrites any Windows Worker/ae-mcp code.

## Why this exists

Before this POC, DYO's core project/job/approval logic had no reason to
name "After Effects" directly, but nothing enforced that separation either
— there was no job execution system at all yet (Phases 1–3 only built the
worker registry, heartbeat, and dashboard). This package answers one
question: **could DYO plug in a second renderer later without an
architecture rewrite, and is Shotstack a plausible one?**

## Shared DYO core

Everything in `packages/renderer` is provider-neutral:

- **`scene-map/scene-map.ts`** — the smallest model that describes *what* a
  video should contain, independent of who renders it: a scene map has
  `scenes[]`, each with a `startMs`/`durationMs`, `assets[]` (image/video/logo
  assignments to a `placeholderId`), `texts[]`, an optional `phonePosition`,
  and optional `transitionIn`/`transitionOut`. This is deliberately small —
  it is a *target* shape both providers translate into their own native
  representation, not a general-purpose video-editing schema.
- **`scene-map/validate-scene-map.ts`** — provider-agnostic business rules
  every renderer must satisfy, regardless of which one executes the job.
  Notably, this is where CLAUDE.md's **permanent DYO brand rules** live as
  code for the first time: every scene map must contain the client/company
  logo at least once, and the Hebrew text `מבית DYO App` at least once.
  Both `AfterEffectsRenderer` and `ShotstackRenderer` call this same
  function — the rule is defined once, not duplicated per provider
  (`docs/engineering/CODE_STANDARDS.md`).
- **`contract/render-provider.ts`** — the `RenderProvider` interface:
  `validateProject`, `prepareAssets`, `createPreview`, `renderLandscape`,
  `renderReels`, `getRenderStatus`. A shared `RenderStatus` vocabulary
  (`QUEUED` / `PROCESSING` / `DONE` / `FAILED`) that every provider maps its
  own native status strings onto.
- **`errors.ts`** — a typed error hierarchy (`RendererConfigError`,
  `RendererNotImplementedError`, `RendererRequestError`,
  `RendererNetworkError`), matching the pattern already used in `apps/api`
  and `apps/worker`.
- **`provider-selection.ts`** — a deliberately trivial lookup by provider
  name. No DI framework, no registry — there is no job dispatcher yet for
  this to plug into, so building one now would be speculative.

## After Effects renderer

`providers/after-effects/after-effects-renderer.ts` is **not** a
reimplementation of the AE pipeline. `validateProject` is real (it's pure
business logic, no AE dependency). Every other method throws
`RendererNotImplementedError` with a message pointing at `apps/worker` —
because that is where AE rendering actually happens, and it requires the
real client Windows machine, which is currently unavailable. This class
exists only to prove After Effects *fits* the same contract Shotstack does;
it must not become a fake success path.

## Shotstack renderer

`providers/shotstack/*` is a genuine (if minimal) working implementation
against Shotstack's real Edit API — see `docs/SHOTSTACK-POC.md` for exactly
what was verified and what wasn't. It has no dependency on `apps/worker`,
ae-mcp, or a Windows machine: Shotstack is a cloud rendering API reached over
plain HTTPS.

## What can be reused if a real provider-based job system is built later

- The `SceneMap` model and its brand-rule validation — both renderers get
  the logo/Hebrew-text/duration rules for free.
- The `RenderProvider` contract and `RenderStatus` vocabulary — a future job
  system could depend on this interface instead of on either renderer
  directly.
- The error taxonomy and the "map raw provider status onto a shared enum"
  pattern (`shotstack-status.ts`) — the same shape would apply to any third
  renderer added later.

## What Shotstack can/cannot currently reproduce

See `docs/SHOTSTACK-POC.md` for the detailed breakdown. In short: Shotstack
can produce a working, brand-compliant, landscape/portrait video from a
scene map (background color, images, videos, logo overlay, text, basic
transitions, correct output resolutions), **including correctly-rendered
Hebrew + Heebo typography with correct RTL ordering** — confirmed via a live
sandbox render (see `docs/SHOTSTACK-POC.md` "Typography smoke test"). It
**cannot** currently reproduce arbitrary existing After Effects template
fidelity — no custom AE expressions/plugins, and "phone mockup" precision is
approximated via generic position/offset values rather than a
purpose-built primitive.

## Fidelity risks vs. After Effects

- **Typography**: Shotstack's `rich-text` asset type is used for text (the
  earlier `title` asset was replaced after a live test showed `rich-text` is
  the documented modern primitive). A live sandbox render confirmed Hebrew
  glyphs render correctly, in correct RTL visual order, with Heebo loaded
  via `timeline.fonts[]`, with no clipping — see `docs/SHOTSTACK-POC.md` for
  the full methodology and what remains unverified (e.g. whether the
  requested Bold weight is visually distinguishable from regular weight).
- **Motion graphics**: DYO's existing Envato AE templates likely use custom
  expressions, precomps, and effects that have no Shotstack equivalent.
  Shotstack's primitives (position, offset, scale, fade transitions) are far
  more limited than an authored AE composition.
- **Phone mockup placement**: this POC maps `phonePosition` to one of
  Shotstack's generic clip `position` values (`center`, `centerLeft`,
  `centerRight`) — this is an approximation, not pixel-accurate placement
  matching a template's actual phone-hardware artwork.
- **Reusing an existing client's AE template as-is**: not possible. Every
  Shotstack video is authored from the provider-neutral scene map, not from
  the client's actual `.aep` file.

## How provider selection would work (design only — nothing consumes this yet)

A future job system would resolve a `RenderProviderName` (`"after-effects"`
or `"shotstack"`) — e.g. from a per-project config field — and call
`selectRenderProvider(name, { "after-effects": ..., shotstack: ... })` to get
a `RenderProvider`. Nothing in the codebase does this yet; no job execution
system exists to make this decision from.

## Recommendation criteria (for a future decision, not a decision made here)

Favor **Shotstack** when: no Windows/AE machine is available, the video is a
simple templated composition (background + image/video + text + logo),
turnaround speed matters more than exact template fidelity, and the client
does not have a bespoke Envato template they specifically paid for.

Favor **After Effects** (the only supported production path today) when:
the client has an existing purchased/branded AE template that must be
reproduced faithfully, the video needs custom motion graphics/expressions,
or exact phone-mockup/typography fidelity is required.

This POC does not recommend switching primary renderers. Shotstack remains
strictly optional and experimental.
