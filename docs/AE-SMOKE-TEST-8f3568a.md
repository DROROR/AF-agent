# After Effects smoke test for build 8f3568a - PREPARED, NOT YET RUN

**Status: PREPARED. Do not run until the worker package has been installed and
its three independent file checks printed `True`** (see `RELEASE-8f3568a.md`).

This is the FIRST real AE exercise of this build. It deliberately uses a
purpose-built, disposable QA project.

**The client's template, the session working copy and session `e0483ad6…` must
not be used for it.** Concretely, none of these may appear anywhere in this
test:

- `C:\DYO-Agent\copies\mixkit-smartphone-promo-596\596\App_Promo.aep`
  (sha256 `4172ee08…`) or any copy of it,
- the working copy behind session `e0483ad6-98c4-4e8a-90ae-3a30d43a5d90`,
- project `65e24d16-f97a-4d48-bb60-c7df30b17e51` or its Revision 4.

Nothing in this procedure creates a Revision 5 of the client plan or renders
the client's video.

## Why a purpose-built project

The build changes what happens when a project is OPENED (a disposable copy is
used instead of the real file), what a slot IS (structural classification), and
when a slot counts as visible. A template whose structure we already argued
about cannot test those honestly, and the client's approved session must not be
the first thing a new build touches. The QA project below is built to contain,
in one file, each shape the new code must tell apart.

## Step 1 - build the QA project (QA machine, ~5 minutes)

On the worker machine, create the folder layout first. Relative footage is the
point: the disposable-copy wrapper places its copy BESIDE the project so
relative paths still resolve, and this proves it.

```
C:\DYO-Agent\qa\smoke-8f3568a\
    QA-Smoke.aep            <- created by the script below
    footage\
        hardware-pass.png   <- any opaque image, 1080x2160 portrait
        screenshot.png      <- any opaque image, 1080x2160 portrait
        logo.png            <- an image WITH a transparent background
```

Any three images will do; they only need those shapes and transparency
properties. Put them in `footage\` before running the script.

Then in After Effects: **File → Scripts → Run Script File…** and choose
`scripts/qa/build-qa-smoke-project.jsx` from this release's ZIP (it is also in
the repository). It creates `QA-Smoke.aep` containing:

| Composition / layer | What it is there to test |
|---|---|
| `QA_Scene` | the scene composition |
| `QA_Screen` precomp, placed in `QA_Scene` with an **ALPHA matte from the rendered hardware image**, 3D enabled, parented to an animated null | must classify as **device_screen** |
| `QA_Card` precomp, placed with an **ALPHA matte from a drawn solid**, 2D, unparented | must classify as **flat_card** |
| `QA_Hebrew` text layer, initial text `טקסט תבנית` | RTL application and read-back verification |
| `QA_Offscreen` copy of the card, positioned entirely outside the frame | must be reported as NOT on screen |
| `QA_FadedOut` copy of the card, opacity keyframed 0 → 0 across its whole span | must be reported as NOT on screen |
| Every layer's in/out points staggered | evidence-frame moment must land inside a genuinely visible window |

Save and CLOSE the project in After Effects before continuing. The worker must
find it closed.

## Step 2 - register it as a project in the dashboard

1. Dashboard → New Project → inspect `C:\DYO-Agent\qa\smoke-8f3568a\QA-Smoke.aep`.
2. **While the inspection runs, watch the file itself.** Expected, and the
   first thing this build must prove:
   - a file named `QA-Smoke.dyo-inspect-<uuid>.aep` appears next to it, and
     disappears again;
   - `QA-Smoke.aep`'s own modified-time and size do not change;
   - After Effects is left with whatever it had open before (nothing, if you
     closed it).
3. Record `QA-Smoke.aep`'s sha256 before and after (`Get-FileHash`). They must
   be identical. **If they differ, stop and report - do not continue.**

## Step 3 - what the manifest must say

Open the project's scene table. Expected:

- `QA_Screen` is classified **device_screen** with high confidence, and its
  evidence lists the rendered-footage matte, the 3D host and the animated
  parent.
- `QA_Card` is classified **flat_card**, its evidence naming the drawn matte.
- Neither classification mentions a layer name as a reason.
- The Hebrew text layer carries the template's own wording as captured text.

## Step 4 - the gates must block, for the right reasons

Map assets deliberately wrongly, and confirm each refusal:

1. Map `logo.png` (transparent) into `QA_Screen` → approval must be refused
   with `ASSET_SLOT_CONFLICT`, naming the see-through background and the
   percentage of the asset that is see-through.
2. Map `screenshot.png` into `QA_Card` → refused with `SCREENSHOT_INTO_FLAT_CARD`.
3. Leave the Hebrew layer at its template wording → refused as unreviewed
   template copy.
4. For each, the scene editor must offer the decision buttons **disabled**
   until an evidence frame exists.

## Step 5 - evidence frames

1. Click **Capture evidence frame** on the blocked slot.
2. The captured frame must show `QA_Screen` genuinely on screen - not black,
   not mid-transition.
3. Repeat on the `QA_Offscreen` and `QA_FadedOut` mappings: both must report
   that the slot never presents a provable visible moment, and must offer no
   decision at all. **A captured frame for either of those is a failure.**
4. Record an explicit decision on the legitimate blocked slot and confirm the
   plan then approves.

## Step 6 - execute one frame

1. Map `screenshot.png` into `QA_Screen` and replace the Hebrew text with
   `מבית DYO App`.
2. Approve, then execute the first frame.
3. Expected:
   - the working copy is mutated, the source `QA-Smoke.aep` is not (hash it
     again);
   - the preview shows the screenshot inside the screen slot, right way up,
     not stretched;
   - the Hebrew reads correctly and is verified by code units in the job
     result, not by eye.

## Step 7 - the fingerprint must fail closed

1. With the plan approved, open `QA-Smoke.aep` in After Effects and add one
   layer above the screen slot inside `QA_Screen`. Save and close.
2. Re-run template inspection, then execute the same frame again **without**
   re-approving.
3. Expected: the operation is refused before anything is applied, saying the
   slot's structure changed since the plan was approved.

## Step 8 - tidy up

Delete `C:\DYO-Agent\qa\smoke-8f3568a\` and the QA project from the dashboard.
The QA project exists only for this test.

## Stop conditions

Stop and report immediately, without continuing, if any of these happen:

- `QA-Smoke.aep`'s hash changes at any point;
- a disposable copy is left behind after a job finishes;
- After Effects is left holding a project it did not have open before;
- an evidence frame is produced for a slot that is never visible;
- a gate passes something this document says it must block.

## Only after all of the above passes

The client's own project may then be re-inspected to regenerate its manifest
with slot facts (its Revision 4 predates them and will block image mappings
until then). That is a separate, explicitly authorised step - not part of this
smoke test.
