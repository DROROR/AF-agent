# Shotstack Renderer POC

**Status: experimental, isolated in `packages/renderer/src/providers/shotstack/`.**
No production credentials were used, and none are committed. See
`docs/RENDERER-ARCHITECTURE.md` for how this fits alongside the (unaffected)
After Effects renderer.

## Typography smoke test (live sandbox render) — 2026-08-22

**Result: PASS.** This was a live render against the real Shotstack
**sandbox** API (`SHOTSTACK_ENV=sandbox`, base URL
`https://api.shotstack.io/edit/stage` — no production credits used),
verifying the single highest-risk requirement before any further renderer
work: does Hebrew + Heebo actually render correctly?

- **Exact asset type used**: `rich-text` — switched from the earlier
  `title` asset used in the initial bounded POC. Shotstack's docs don't
  formally mark `title` deprecated, but `rich-text` is the documented modern
  primitive with the styling surface (`font`, `align`, etc.) this needs, per
  explicit instruction to prefer it.
- **Font loading method**: `timeline.fonts: [{ src: "<Heebo TTF URL>" }]`,
  referenced from each text clip via `asset.font.family: "Heebo"`. The font
  file used is Heebo's real, publicly-hosted variable font from the
  `google/fonts` GitHub repo — verified reachable (`HTTP 200`,
  `access-control-allow-origin: *`) before use:
  `https://raw.githubusercontent.com/google/fonts/main/ofl/heebo/Heebo%5Bwght%5D.ttf`.
  `font.weight: 700` was used to request Heebo Bold via the variable font's
  weight axis (Heebo ships only as a variable font upstream — no separate
  static Bold file exists in the source repo).
- **Whether Heebo loaded**: yes. The live render's own status response
  (`GET /render/{id}`) echoed back
  `metadata.customFonts: [{ family: "Heebo", src: "<our exact URL>", weight: 700 }]`
  for every text clip — confirming Shotstack's renderer received and
  registered the font, not silently ignoring it.
- **Whether Hebrew rendered**: yes. Real Hebrew glyphs render — not tofu
  boxes, not a Latin fallback, not mojibake.
- **Whether RTL order was visually correct**: yes, for the mixed-script
  line. The content string was `"מבית DYO App"` (Hebrew first, logically).
  The rendered output shows `DYO App` positioned to the **left** and `מבית`
  positioned to the **right** — correct for an RTL-initial bidi paragraph,
  where the first logical run (Hebrew) anchors at the right edge of the
  line and subsequent runs (the embedded LTR "DYO App") flow to its left.
  The pure-Hebrew line (`"בדיקת טיפוגרפיה בעברית"`) also rendered as a
  coherent right-to-left phrase with no visible letter-order corruption.
- **Clipping/alignment**: no clipping — every line's rendered (non-transparent)
  pixels stayed well clear of all four canvas edges (measured directly from
  the decoded PNG alpha channel, not just eyeballed). Alignment matched the
  configured `center`/`middle` — text sat centered in its box in all three
  lines.
- **Mixed Hebrew + English readability**: PASS — both scripts render
  clearly, are visually distinct, correctly ordered, and don't overlap.

### Methodology (so this claim can be checked, not just trusted)

1. Submitted a real 5-second, 1080×1920 render via
   `scripts/shotstack/typography-smoke-test.ts` (uses the actual, updated
   `ShotstackRenderer`/`buildShotstackEditPayload` code — not a bespoke
   one-off request) containing three simultaneous text lines: `"מבית DYO App"`,
   `"בדיקת טיפוגרפיה בעברית"`, and `"DYO App"`, plain dark background, Heebo
   Bold, no animation, no client assets. Render ID
   `d239f00b-4a2a-43d4-8f4c-89651e83b797`, status `done`, `renderTime` ≈ 3.9s.
2. Rather than trust a claim of "it rendered," the actual **rasterized text
   layers** Shotstack generates internally (one PNG per `rich-text` clip,
   composited into the final MP4 — confirmed via the render job's own
   `data.timeline` in the status response, which lists these exact PNGs as
   the clip assets) were downloaded directly from their real S3 URLs.
3. Those PNGs are white text on a transparent background, so a small
   (~90-line) pure-Node script was written to decode each PNG's raw pixel
   data (manual PNG inflate + unfilter — no new dependency), confirm glyphs
   actually drew non-transparent pixels (not literally blank), record the
   bounding box of visible pixels (clipping/alignment check), then composite
   each one over the test's own background color (`#101820`) so the white-
   on-transparent text becomes visible for direct inspection.
4. The composited images were viewed directly and are what the "whether
   Hebrew rendered"/"RTL order" findings above are based on.
5. The final MP4 itself was also downloaded and confirmed to be a valid,
   non-trivial `ISO Media` file (~119KB, matching a simple 5s render) as a
   sanity check — no local tool was available in this environment to decode
   an actual video frame from it, so the rasterized-text-layer inspection
   above (which uses the literal same assets the video composites) is the
   basis for the typography findings, not a decoded video frame.
6. All downloaded media (PNGs, the MP4, debug scripts) were deleted after
   inspection — nothing was committed, per instruction.

### Two real bugs found and fixed by this live test

Live testing surfaced two payload mistakes that mocked-HTTP tests couldn't
have caught, both now fixed in `shotstack-payload.ts` and covered by new
tests:

1. **Empty tracks are rejected.** Shotstack's real validation:
   `"Too small: expected array to have >=1 items at timeline.tracks[0].clips"`.
   A scene map with, say, no video/image assets used to produce a track with
   an empty `clips: []` array — now such a track is omitted entirely.
2. **`width`/`height` belong on the clip, not the asset.** Real error:
   `"Unknown property \"width\" at timeline.tracks[1].clips[0].asset"`. Fixed
   by moving `width`/`height` off `ShotstackAsset` and onto `ShotstackClip`.

A third, non-bug gap was also fixed: multiple simultaneous text lines in one
scene previously all rendered at the exact same position (full overlap).
`textClips()` now spaces stacked lines vertically using Shotstack's `offset`
field (confirmed normalized `-1..1`, not pixels, via Shotstack's own docs).

### What remains unverified after this test

- Whether `font.weight: 700` actually produced a visually bolder result than
  the default (no side-by-side regular-vs-bold comparison was rendered).
- Font rendering in the final compressed H.264 video frame specifically
  (compression artifacts, color space) — not decoded here, only the
  pre-composite rasterized text layer was inspected (see methodology above).
- Any script other than Hebrew/English (e.g. Arabic) — out of scope for this
  smoke test.
- Reference-video → scene-map extraction — still not implemented (unchanged
  from the original bounded POC; see below).

## What was verified vs. inferred (original bounded POC + this smoke test)

Shotstack's own published API documentation (`https://shotstack.io/docs/api/`
and its full-text reference) was read directly before writing any code, and
the live smoke test above additionally verified real request/response
behavior end-to-end. Confirmed:

- Base URLs: sandbox `https://api.shotstack.io/edit/stage`, production
  `https://api.shotstack.io/edit/v1`.
- Render endpoint: `POST /render`; status endpoint: `GET /render/{id}`.
- Auth header: `x-api-key`.
- Request body top-level keys: `timeline` (`background`, `fonts[]`,
  `tracks[]`), `output` (`format`, `size: {width, height}`).
- Track/clip shape: `clips[]`, each with `asset`, `start`, `length`,
  `width`/`height` (**clip**-level, not asset-level — live-verified),
  `position`, `offset` (normalized `-1..1` — live-behavior consistent),
  `transition: {in, out}`.
- `rich-text` asset fields used here: `text`, `font: {family, weight, color}`,
  `align: {horizontal, vertical}`.
- `timeline.fonts[].src` + `font.family` matching the font's embedded name
  (`"Heebo"`) — confirmed working via the live render's echoed
  `customFonts` metadata.
- Render status lifecycle, in order: `queued` → `fetching` → `rendering` →
  `saving` → `done`, with `failed` as the terminal error state — the live
  test observed `rendering` → `done` directly.
- Response shapes for both create-render and get-status calls.

**Still not verified / simplified:**
- Which `transition` values beyond `"fade"` are valid — not risked without
  confirming their exact accepted strings.
- The full `rich-text` field surface beyond what's used here (`size`,
  `stroke`, `shadow`, `background`, `style.letterSpacing`, etc.).
- Production environment behavior (`SHOTSTACK_ENV=production`) — only
  sandbox was ever used.

## Configuration

```
SHOTSTACK_API_KEY=replace-me-with-a-real-shotstack-api-key
SHOTSTACK_ENV=sandbox   # or "production"
```

Loaded and Zod-validated by `shotstack-env.ts`
(`loadShotstackConfig(process.env)`); throws `RendererConfigError` (never a
raw string) if the key is missing or `SHOTSTACK_ENV` isn't `sandbox` /
`production`. The API key is never logged — errors thrown by
`shotstack-client.ts` never include it (unit-tested). The live smoke test
(`scripts/shotstack/typography-smoke-test.ts`) additionally refuses to run
at all unless `SHOTSTACK_ENV` resolves to `sandbox`.

## What the POC proves (Step 2 checklist)

`shotstack-payload.ts` (`buildShotstackEditPayload`) takes a provider-neutral
`SceneMap` and produces a real Shotstack Edit API request body, covering:

| Requirement | How |
|---|---|
| Image asset | `assetType: "IMAGE"` → Shotstack `image` clip |
| Video asset | `assetType: "VIDEO"` → Shotstack `video` clip |
| Text | scene `texts[]` → Shotstack `rich-text` clips on their own track, stacked with distinct offsets when more than one line shares a scene |
| Logo | `assetType: "LOGO"` → forced `position: "topRight"`, regardless of scene's phone position |
| Background/brand color | `SceneMap.brandColor` → `timeline.background` |
| Positioning | `scene.phonePosition` → Shotstack `position` (`center`, `centerLeft`, `centerRight`) |
| Timing | `scene.startMs`/`durationMs` → clip `start`/`length` (converted to seconds) |
| Transition | `scene.transitionIn`/`transitionOut` → clip `transition.in`/`out` (`"fade"` only; `NONE` omits the field) |
| Landscape render | `output.size: {1920, 1080}` |
| 1080x1920 render | `output.size: {1080, 1920}` — CLAUDE.md's own required native Reels resolution — **this exact size was used in the live typography test** |
| Render status polling | `ShotstackClient.getRenderStatus` → `shotstack-status.ts` maps the raw string onto the shared `RenderStatus` enum — **live-verified** (`rendering` → `done`) |
| Output retrieval | `RenderStatusResult.outputUrl` from Shotstack's `response.url` — **live-verified**, a real playable MP4 was downloaded |
| API authentication/config | `shotstack-env.ts` + the `x-api-key` header — **live-verified** |
| Custom font registration | `timeline.fonts[]` + `font.family` — **live-verified** via the live smoke test |

`ShotstackRenderer` (`shotstack-renderer.ts`) wires all of this into the
shared `RenderProvider` contract, and now also accepts an optional
`fontUrls` option (threaded through its constructor) for registering custom
fonts like Heebo. One deliberate simplification remains: `createPreview`
just triggers a real landscape render and returns its handle — Shotstack's
documented API has no distinct lightweight "preview" endpoint verified here.

## Reference-video → scene-map: what's deterministic vs. what needs AI/vision

Unchanged from the original bounded POC — **still not implemented.** See
`docs/RENDERER-ARCHITECTURE.md` for the full breakdown. In short: this POC
builds the destination `SceneMap` model and one deterministic executor
(Shotstack); it does not build anything that goes from an arbitrary
reference video to a populated scene map automatically. That would require
real AI/vision work (scene boundary detection, phone-mockup region
detection, on-screen text/timing extraction, brand color detection) that
does not exist in this codebase.

## Fidelity limitations

- Transition support is deliberately limited to `"fade"`; broader
  transition/animation fidelity matching an AE template is not attempted.
- Phone-mockup positioning is a coarse approximation (one of four generic
  positions), not pixel-accurate placement.
- No custom AE expressions, precomps, or plugin effects have any Shotstack
  equivalent attempted here.
- Bold-weight rendering via a variable font's weight axis was requested but
  not independently confirmed against a non-bold sample (see "what remains
  unverified" above).

## Files

New this round: `scripts/shotstack/typography-smoke-test.ts` (the live
smoke test script — safe to re-run any time against sandbox; refuses to run
against production).

Modified this round (all within the existing isolated POC — zero changes
to `apps/api`/`apps/worker`/`apps/web`):
`packages/renderer/src/scene-map/scene-map.ts` (added optional `fontWeight`
to `TextAssignment`), `packages/renderer/src/providers/shotstack/shotstack-payload.ts`
(rich-text instead of title, clip-level width/height, omit-empty-tracks,
multi-line vertical stacking, `fontUrls` option), `shotstack-renderer.ts`
(threads `fontUrls` through to the payload builder), plus their tests.
`package.json` (root) gained the `@dyo/renderer` dependency, the
`shotstack:typography-smoke-test` script, and `tsx` as a root devDependency
(needed to run the standalone script — already used elsewhere in this repo,
e.g. `apps/api`/`apps/worker`). `.env` (repo-root, gitignored, never
committed) gained the real sandbox `SHOTSTACK_API_KEY`/`SHOTSTACK_ENV`.

Original bounded-POC files (unchanged in kind, see prior version of this
doc / `docs/RENDERER-ARCHITECTURE.md` for the full original file list):
`packages/renderer/**` (contract, scene-map, errors, provider-selection,
both providers, all colocated tests), `docs/RENDERER-ARCHITECTURE.md`.

## Tests

61 tests across the `packages/renderer` suite (up from 52) — added coverage
for: clip-level width/height, omit-empty-tracks behavior, multi-line
vertical stacking, custom `fontUrls` registration, and a text assignment's
own `fontFamily`/`fontWeight` overriding the Heebo default.

## Recommendation for an actual side-by-side POC

The first gate from the original recommendation is now cleared: **Hebrew +
Heebo typography passes** on a real Shotstack sandbox render. Next steps,
in order:

1. Render a second sample with plain (non-bold) weight alongside the bold
   one, side by side, to actually confirm the weight axis is being
   interpolated rather than ignored.
2. Get one real reference `SceneMap` (hand-authored from an existing simple
   template, not auto-extracted) and submit it to Shotstack's sandbox to
   see real output quality for a complete scene (images/video/logo/text
   together), not just isolated typography.
3. Only after (1) and (2), consider a real side-by-side render of the same
   scene against both the AE pipeline and Shotstack, once the real
   Windows/AE machine is available again, to compare actual fidelity rather
   than assumptions.

Still not recommended: expanding Shotstack integration beyond this bounded
POC, declaring it primary, or beginning reference-video recreation work.
