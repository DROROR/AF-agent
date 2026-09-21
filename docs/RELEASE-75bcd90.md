# Correction release 75bcd90 - a still matte is not a rendered hardware pass

Build commit: `75bcd908d05752d573eedd55587c244f1076e270` (branch `main`).
Corrects `8f3568a`; see `RELEASE-8f3568a.md` for everything else that build
shipped.

## What was wrong

After Effects reports `hasVideo` for a STILL image as well as for a movie - a
still has visual content. The matte-source rule checked `hasVideo` before
`isStill`, so every imported PNG matte was read as `RENDERED_FOOTAGE` (a
rendered hardware pass), the `isStill` branch below it was unreachable for real
footage, and a static card cut by a drawn PNG could carry a **confident
`device_screen` verdict** - the exact mistake the whole slot gate exists to
prevent.

## The correction

`isStill` is checked first. `RENDERED_FOOTAGE` now means what it says: moving
footage, `hasVideo` AND NOT `isStill` - a video file or an image sequence.

The authored-shape category is unchanged in behaviour and now documented
explicitly. Three distinguishable facts are grouped into
`DRAWN_MASK_OR_SOLID`, because they are the same claim about intent - somebody
drew a static shape:

| Matte is | Scan fact that identifies it | Verdict |
|---|---|---|
| An After Effects solid | `footage.isSolid` | `DRAWN_MASK_OR_SOLID` |
| A shape or text layer | layer `kind` | `DRAWN_MASK_OR_SOLID` |
| An imported still image | `footage.isStill` | `DRAWN_MASK_OR_SOLID` |
| A video file or image sequence | `hasVideo` and not `isStill` | `RENDERED_FOOTAGE` |
| Anything unreadable | - | `UNKNOWN`, never guessed |

They stay individually distinguishable in the scan and in the evidence shown to
a reviewer; only the verdict groups them.

`SLOT_SEMANTICS_MODEL_VERSION` moves to `slot-semantics-v2`, so a verdict
produced by the old rule is refused as stale and re-inspected rather than
silently reinterpreted. No stored manifest carries a slot verdict yet, so
nothing in this database was invalidated.

## What this affects, and what must be redeployed

| Component | Affected | Why |
|---|---|---|
| Worker | **yes - replacement package below** | owns `build-slot-facts.ts`, the corrected rule |
| `@dyo/schemas` | **yes** | the model-version constant |
| API | **yes - redeploy** | the slot gate compares stored verdicts against that constant |
| Dashboard | **yes - redeploy** | the scene editor runs the same shared assessment |
| Database | no | no migration in this commit |

The API and the dashboard must be redeployed **before or together with** the
worker update. If the worker writes `slot-semantics-v2` verdicts while the API
still holds `v1`, every image mapping blocks as `SLOT_SEMANTICS_STALE_MODEL` -
fail-closed, but useless. Deploy as usual:

```bash
bash scripts/deploy-production.sh 75bcd908d05752d573eedd55587c244f1076e270
```

## Replacement worker package

The `8f3568a` worker ZIP is superseded. Do not install it.

| | |
|---|---|
| File | `/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-75bcd90.zip` |
| SHA-256 | see the report accompanying this release |
| Build commit | `75bcd908d05752d573eedd55587c244f1076e270` (in `worker-app/BUILD_INFO.json`) |
| Installer | `DYO-Worker-SlotSemantics-Update.ps1` (unchanged in behaviour) |

Install exactly as documented in `RELEASE-8f3568a.md`, substituting this
filename and hash, and expecting `BUILD_INFO.json` to read `75bcd90…`.

## Corrected QA fixture

The `8f3568a` fixture is superseded: its matte was a still PNG, so it could not
tell the two source types apart. The corrected fixture ships a **12-frame PNG
sequence** as a moving matte alongside the still one, and builds two slots that
are identical in every way except what their matte is made of:

| Slot | Matte | Must report |
|---|---|---|
| `QA_ScreenHost` | the moving image sequence | `RENDERED_FOOTAGE`, confident `device_screen` |
| `QA_StillMattedHost` | the still image | `DRAWN_MASK_OR_SOLID`, conflicting, needs a human decision |

**If those two report the same matte source, the smoke test has failed.**

The builder also refuses to produce the project at all if After Effects imports
the sequence as a still, rather than building a fixture that cannot test
anything. It extracts to a new folder, `C:\DYO-Agent\qa\smoke-75bcd90`, so
nothing from the superseded fixture can be left behind in it.

## Verification

- Full suite: 316 files, 4,075 tests, 0 failures. `npm run typecheck` clean,
  `npm run lint` clean.
- New regression tests pin all four source shapes: an imported still
  (`hasVideo` true, `isStill` true), moving footage (`hasVideo` true, `isStill`
  false), an AE solid and a drawn mask, and missing/unknown facts - plus an
  explicit test that the still and moving cases must **not** produce the same
  fact, and one proving the same 3D animated host reads as a confident device
  screen with a moving matte and as conflicting with a still one.
