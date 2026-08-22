# Shotstack Reference Recreation POC — Cognetica

**Status: bounded fidelity test, isolated in `packages/renderer` +
`scripts/shotstack/cognitica-reference-poc.ts`.** This does not replace,
modify, or migrate the After Effects architecture. It uses **real** client
assets from `/opt/AF-agent/local-inputs/cognitica/` (gitignored, never
committed) to answer one question: how closely can Shotstack recreate one
real, human-approved DYO/Cognetica reference video?

**No final visual approval is claimed here.** Every judgment below is mine,
based on frame-level inspection of the real reference render and the
Shotstack sandbox output. Actual client/human sign-off on the rendered MP4s
is still required before any conclusion here is treated as final.

## Real reference video: actual timeline (not the work-map's stale timings)

The work map (`cognetica map.docx`) documents each frame's *"Source
Position"* as its position in the **original stock Envato template**, before
the client's requested duration extensions. Its own instructions say
explicitly: *"extend the duration of each frame in the template to
approximately 4 seconds"* before inserting assets — so those numbers cannot
be the final video's real timing, and are not used here.

Instead, both real rendered reference videos (`dro rendered horizontal
new.mp4`, 1920×1080, and `Dro render vertical new.mp4`, 1080×1920 — both
31.73s, 29.97fps, H.264, `ffprobe`-confirmed, identical edit in two aspect
ratios) were analyzed directly with `ffmpeg`/`ffprobe`: a 1fps contact sheet
for the full timeline, then 4–8fps contact sheets zoomed into every
transition, to find real cut points. Every timestamp below comes from that
analysis, not the docx.

| Scene | Start | End | Duration | Transition in/out (real) |
|---|---|---|---|---|
| Opening Frame | 0.00s | ~4.5s | ~4.5s | — / 3D phone flip (~1.0s) |
| Frame 1 | ~4.5s | 8.0s | ~3.5s | 3D flip / instant cut |
| Frame 2 | 8.0s | ~12.9s | ~4.9s | instant / 3D flip (~1.65s, longest of the "flip" transitions) |
| Frame 3 | ~12.9s | 16.0s | ~3.1s (shortest scene) | 3D flip / instant |
| Frame 4 | 16.0s | ~20.65s | ~4.65s | instant / quick re-scale cut (~0.15–0.25s, notably *not* a 3D flip like the others) |
| Frame 5 | ~20.65s | ~24.75s | ~4.1s | quick cut / 3D flip (~1.5s, longest transition — leads into the 2-phone scene) |
| Frame 6 | ~24.75s | 31.73s | ~6.98s (longest scene) | 3D flip / fade to black (end of video) |

Notes from direct frame inspection (all Shotstack-relevant, all real
findings, not invented):
- **Background**: a consistent pale pink/lavender, sampled directly from a
  real extracted frame: **`#FEF8FD`** — not literally white or black despite
  the work map's "change background from black to white" instruction; this
  is the client's actual final choice, used throughout every scene.
- **Phone position**: Frame 1 = phone left / text right. Frame 2 = phone
  right / text left. Frame 3 = phone left / text right. Frame 4 = phone left
  / text right. Frame 5 = phone right / text left. Frame 6 = **two phones**,
  side by side, roughly centered as a pair — confirmed directly from the
  video (and from the asset folder naming: `L-from 1M.mp4` + `R.mp4`).
- **Floating gold dot decorations** appear in every scene, persisting
  through cuts — almost certainly a 2D particle/bokeh layer from the base
  Envato template, recolored to the mustard brand tone.
- **Every scene-to-scene transition except one is a full 3D phone rotation**
  (the phone flips to show its back/edge before the next scene's content
  appears) — this is the `Element` 3D plugin identified in the AE project
  report (see below), and **Shotstack has no 3D capability at all**. This is
  the single largest, unavoidable fidelity gap.

## Cross-reference: work map + real assets + AE project + real videos

- **`cognetica map.docx`**: 7 scenes (Opening + Frames 1–6), exact Hebrew
  headline/subheadline/branding text for each, general brand-color
  instruction ("gray and mustard/yellow", referencing `cognetica.co.il`).
- **`dro tempelate project folder.zip`**: the customized `.aep`
  (`dro tempelate fixed.aep`) + its own AE-generated report
  (`...Report.txt`), read in-memory. Confirms: 10 numbered comp groups
  (`Scene 1`–`Scene 10` internally, more than the 7 client-facing frames —
  the template has more slide types than this client used), font
  `"Evolventa" Bold` referenced on a text layer (see typography compromise
  below), and 9 real effects in use: **Angle Control, Camera Lens Blur,
  Color Balance (HLS), Color Range, Curves, Drop Shadow, Element, Gradient
  Ramp, Tint**. `Element` is Element 3D — confirmed by the nested Envato
  template also bundling a literal 3D phone model
  (`Phone Model/Phone 12 Pro.obj`) + a reflection map. The phone mockup is a
  true 3D render, not a flat image.
- **`בית קוגנטיקה (1).zip`**: numbered folders `1`–`6` + `Opening Frame`,
  each holding exactly the footage/screenshot that scene needs — confirmed
  to map 1:1 onto Frames 1–6 + Opening by cross-referencing the AE report's
  own "Collected source files" list, which references these exact same
  numbered-folder paths.
- **Real per-scene asset mapping** (folder → file → scene), with trim points
  taken directly from the filenames themselves (`R-from 36 s.mp4` etc.) —
  deterministic, not guessed:

| Scene | Real asset | Type | Trim point (from filename) |
|---|---|---|---|
| Opening | `Opening Frame/from 2.5 s When you see their faces staring.mp4` | video | 2.5s |
| Frame 1 | `1/Screenshot_20260702_162313.jpg` | image | — |
| Frame 2 | `2/R-from 36 s.mp4` | video | 36s |
| Frame 3 | `3/R-from 22 s.mp4` | video | 22s |
| Frame 4 | `4/from 2 s.mp4` | video | 2s |
| Frame 5 | `5/צילום מסך 2026-07-03 134931.png` | image | — |
| Frame 6 (left phone) | `6/L-from 1M.mp4` | video | 60s ("1M" = 1 minute) |
| Frame 6 (right phone) | `6/R.mp4` | video | 0s |

**Real discovery**: `2/R-from 36 s.mp4`, `3/R-from 22 s.mp4`, and
`6/L-from 1M.mp4` are **byte-identical** (confirmed via `md5sum`, all
78,363,505 bytes) — one single ~146.5s screen recording, reused at three
different trim points across three different scenes. This was uploaded to
Shotstack **once** and reused via `asset.trim`, not uploaded three times.

- **Logo**: `workshop_logo_.png`, visually confirmed as the real Cognetica
  logo ("Cognetica — School of Psychotherapy — Clinical Excellence" circular
  badge). Used in Frame 1 and Frame 6.
- **DYO App logo**: a separate asset (`Screenshot 2026-07-04 000235.png`,
  blue owl mark + "DYO APP" wordmark) exists and appears inline with the
  branding text in the real reference video, but is **not** composited as a
  separate image element in this POC's recreation — see "compromises" below.
- **Brand colors sampled directly from real assets** (not invented):
  mustard/gold `#BC892D` and warm gray-sage `#738579` (sampled from two
  small circular icon-badge assets bundled in the template), consistent with
  the work map's "gray and mustard/yellow" instruction and with the
  "Community" highlight color visible in a real app screenshot.

## Step 3 — Branding safety

The permanent DYO text — `מבית DYO App` — is used exactly as required, only
ever embedded inside the real, verified Frame 1 branding line
`עכשיו באפליקציה מבית DYO App`. **Every Hebrew string used in the recreated
SceneMap was verified byte-for-byte (Unicode codepoint comparison, via a
small Python script) against the actual text extracted from
`cognetica map.docx`** before any render was submitted — specifically to
catch the RTL transcription/reversal risk this step warned about. All
matched exactly; nothing was retyped by eye and trusted blind.

**Official DYO blue HEX: pending, not invented.** No `dyo-brand-rules.yaml`
and no confirmed brand-guide value exists anywhere in this repo. A visual
sample was taken from the DYO logo asset (`#1F388E`) purely for reference —
**this is not used anywhere in the actual render**. Per instruction, the
real DYO logo asset itself would be the correct way to carry DYO branding
color-accurately, but (see compromises) it was not composited as a separate
image in this POC; the recreation's own colors (background, mustard, gray)
all come from Cognetica's own sampled brand assets, not from DYO's.

## Compromises (documented, not hidden)

- **Every 3D phone-flip transition** (5 of 6 scene changes) is approximated
  as a simple 2D fade — Shotstack has no 3D capability at all. This is the
  single biggest fidelity gap and is expected, not a bug.
- **The floating gold particle/bokeh decoration** seen in every scene of the
  real reference is not reproduced — Shotstack has no dedicated particle
  system, and reproducing it would need a pre-rendered transparent overlay
  video/image, which was out of scope for this bounded POC.
- **The DYO App logo icon** (separate from the Cognetica logo) that appears
  inline with the branding text in Frame 1 is not composited as its own
  image element — only the required text is reproduced. Reason: the
  SceneMap's `LOGO` asset type is deliberately simple (one auto-positioned
  top-right logo per scene); a second, differently-positioned logo badge
  would need either a second logo slot or explicit per-asset positioning
  beyond what's justified to add for one specific placement in this bounded
  POC.
- **The App Store / Google Play badge image** (`App markets.png`), which the
  work map explicitly asks to keep in Frame 6, is likewise not composited —
  same reasoning as above (a third distinctly-positioned image element in
  one scene).
- **Typography font**: the AE project's own report names `"Evolventa"
  Bold` as an external font dependency on a text layer — but Evolventa has
  no Hebrew glyph coverage, so it almost certainly is not what actually
  renders the client's Hebrew headlines in the real reference (more likely a
  leftover reference from an original, since-replaced template text layer).
  This recreation uses **Heebo** throughout, per CLAUDE.md's permanent DYO
  brand font requirement and the prior live-verified Hebrew+Heebo smoke test
  — not Evolventa, and not a guess at whatever font the real Hebrew text
  actually uses (unconfirmed, would require opening the `.aep` in real After
  Effects).
- **Scene-boundary timing** is contiguous in this recreation (cut points set
  at the midpoint of each real transition zone) rather than preserving the
  reference's exact 1–1.75s transition-zone duration, since Shotstack's fade
  approximation doesn't need that extra time the way a 3D flip does.

## Step 4/5 — Shotstack recreation and real sandbox renders

Built via the real, updated `ShotstackRenderer`/`buildShotstackEditPayload`
(not a bespoke one-off): 8 unique real local assets uploaded once each via
Shotstack's Ingest API (`POST /ingest/stage/upload` → presigned S3 PUT → the
same upload `id` auto-registers as a source → polled until `ready`) — this
upload flow was empirically reverse-engineered against the real sandbox API
in this session (Shotstack's own docs don't fully specify it) and is now a
tested, reusable part of `packages/renderer`
(`shotstack-upload.ts`/`.test.ts`). A real 7-scene `SceneMap` was built from
the table above and passed `validateSceneMap` (logo present, required
Hebrew text present) before either render was submitted.

### Real sandbox render results

Both real API bugs below were caught only by submitting to the live API —
neither was documented anywhere found in Shotstack's public docs:

- **`position: "centerLeft"`/`"centerRight"` do not exist.** The real
  validation error: *"Invalid option: expected one of top|topRight|right|
  bottomRight|bottom|bottomLeft|left|topLeft|center"*. Fixed in
  `PHONE_POSITION_TO_SHOTSTACK_POSITION` (now `left`/`right`/`center`).
- **Shotstack has an undocumented `preprocessing` status**, returned between
  `queued` and `fetching`/`rendering` (asset/font pre-fetch), not listed in
  Shotstack's own status-lifecycle docs. Added to `SHOTSTACK_STATUSES` only
  after observing it on a real render - not guessed.

| | Landscape | Vertical/Reels |
|---|---|---|
| Render ID | `84f630a8-c35c-45bd-ae41-e180e91ed4d3` | `bd66abba-9764-4346-90f6-c6d29677bdbe` |
| Final status | `done` | `done` |
| Resolution | 1920×1080 | 1080×1920 |
| Duration | 31.77s (`ffprobe`-confirmed) | 31.77s (`ffprobe`-confirmed) |
| Codec | H.264 + AAC | H.264 + AAC |
| Output URL | `https://shotstack-api-stage-output.s3-ap-southeast-2.amazonaws.com/k9rltdk3g0/84f630a8-c35c-45bd-ae41-e180e91ed4d3.mp4` | `https://shotstack-api-stage-output.s3-ap-southeast-2.amazonaws.com/k9rltdk3g0/bd66abba-9764-4346-90f6-c6d29677bdbe.mp4` |
| Preprocessing time | ~60s | ~170s (notably slower - same shared 78MB asset referenced 3 times may be re-fetched per reference) |

Both outputs were downloaded and sent to the user directly for review (never
committed to the repo). Duration matches the real reference's 31.73s almost
exactly - scene order and timing are correctly reproduced end-to-end.

### What frame-level inspection of the real output actually shows

Contact sheets (1fps overview + full-resolution close-ups) were pulled from
both real outputs, the same method used to analyze the original reference.

**Works correctly:**
- Scene order and per-scene duration match the planned timeline precisely.
- Every trimmed video plays the correct real content at the correct trim
  point (Frame 2/3/4's real app-screen recordings, Frame 5's real community
  screenshot, Frame 1's real client photo - all confirmed by eye).
- Background color (`#FEF8FD`) is correct throughout.
- Where rich-text does render (confirmed in Frame 6 - "התייחסות לסטרס
  בהערכה" visible clearly, white-on-gray-green, Shotstack's own default
  readable background box), Hebrew renders correctly, in correct RTL order,
  consistent with the standalone typography smoke test.
- Real audio track present from the source videos (not silent).

**Real problems found by inspection, not assumed:**
- **The Cognetica logo renders oversized** - with no explicit width/height
  set on the `LOGO` asset, it renders at a large natural size rather than a
  small corner badge, dominating a large fraction of the frame instead of
  sitting unobtrusively top-right like the real reference.
- **Frame 1's headline/subheadline/branding text is not visibly present** in
  either output, despite being correctly included in the submitted payload
  (confirmed via the render job's own echoed `data.timeline`). The exact
  rendering-level cause (interaction between the oversized logo, multiple
  offset text clips, and a full-bleed background image/photo) was not fully
  root-caused within this bounded POC - flagged honestly as unresolved
  rather than guessed at.
- **Frame 6's two-phone layout did not separate into two visually distinct
  side-by-side phones.** `offsetX` alone (without an explicit, narrower
  `width` per clip) was insufficient - both videos render at large/near-
  full-canvas size and overlap rather than sitting cleanly side by side.
- **The vertical render's Frame 1 image reveals the source photo already has
  its own baked-in Cognetica logo, tagline, and DYO copyright footer** (the
  full JPG, uncropped, fits differently in a 1080×1920 canvas) - meaning
  this project's own `LOGO` overlay was partially redundant for this
  specific asset. A production version would need to either crop the source
  photo or skip the separate logo overlay for this particular scene.

## Step 6 — Fidelity evaluation

| Category | Verdict | Why |
|---|---|---|
| Scene order | PASS | All 7 scenes appear in the correct planned sequence, both outputs. |
| Scene timing | PASS | Total duration 31.77s vs. real reference's 31.73s; per-scene durations match the real-derived timeline. |
| Screenshot/video placement (content) | PASS | Every trimmed clip plays the correct real content at the correct point - confirmed by eye against the source files. |
| Phone placement | FAIL | No phone bezel/mockup frame exists at all - content displays edge-to-edge, not confined to a phone-shaped region. |
| Phone scale | FAIL | Assets have no explicit width/height; the logo in particular renders oversized rather than as a small badge. |
| Phone movement | FAIL | Shotstack has no 3D capability - the real reference's phone-flip transitions (5 of 6 scene changes) cannot be reproduced at all; approximated as simple fades. |
| Two-phone Frame 6 layout | FAIL | `offsetX` alone was insufficient - both videos overlap rather than sitting cleanly side by side. |
| Typography (Hebrew rendering) | PARTIAL | Confirmed correct where visible (Frame 6); Frame 1's text was not visibly present in either output for reasons not fully root-caused in this bounded POC. |
| Hebrew RTL | PASS | Correct RTL order confirmed wherever text is visible, consistent with the separate typography smoke test. |
| Logo/branding placement | FAIL | Oversized, unconstrained logo; separate DYO App logo icon and App Store/Google Play badge not composited at all (documented compromises). |
| Transitions | PARTIAL | Present and functional as simple fades; nowhere near the real 3D flip's visual richness. |
| Background/effects | PARTIAL | Brand background color correct; floating gold particle decoration not reproduced. |
| Landscape overall similarity | PARTIAL/FAIL | Correct content, order, and timing; the template's core phone-mockup visual identity is largely absent. |
| Vertical/Reels overall similarity | PARTIAL/FAIL | Same underlying compositing gaps apply equally in the native 1080×1920 output. |

**No final client/human approval is claimed here.** These are my own
frame-level observations from inspecting the actual rendered output, not a
client sign-off. Both real MP4s were sent directly for human review; a
go/no-go decision on visual fidelity should be made after watching them, not
from this table alone.

## Step 6 — Recommendation

**C. Shotstack fidelity is insufficient for this template category; keep
After Effects as primary.**

Reasoning, from what this POC actually found rather than assumption:

- Everything Shotstack is fundamentally good at worked correctly: real
  trimmed video/image playback, correct scene order and timing, correct
  Hebrew+RTL rendering wherever text actually displayed, correct brand
  background color, real audio.
- But this specific template's visual identity is built entirely around a
  **true 3D-rendered phone mockup** (Element 3D + an actual `.obj` phone
  model, confirmed in the AE project report) with 3D-flip transitions
  between every scene. Shotstack has **no 3D capability whatsoever** - this
  is not a configuration gap that more effort closes, it is a hard ceiling.
- Even the *2D* elements that should be straightforward (a correctly-scaled
  corner logo badge, two phones sitting side by side, headline text reliably
  visible over a photo) were not achieved by this bounded POC's simple
  SceneMap authoring - closing those gaps is possible (explicit per-asset
  width/height/scale, a custom phone-bezel overlay image, more careful
  z-ordering) but requires meaningfully more Shotstack-side compositing
  investment than a template-driven AE project needs, for a result that
  still cannot include the 3D phone motion itself.
- **Narrower exception**: for content that does *not* center on a 3D phone
  mockup - a simple background + image/video + text + logo composition -
  Shotstack's core mechanics (proven here: real video trim/playback, correct
  timing, correct Hebrew/RTL) are sound. That is closer to a "B" case
  (useful for simpler videos / secondary renderer) and was already the
  conclusion of the standalone Hebrew/Heebo typography smoke test.

This POC does not recommend any renderer-architecture change. After Effects
remains the primary, supported production renderer for phone-mockup-style
DYO templates like this one.
