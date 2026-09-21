# Correction release 75bcd90 - a still matte is not a rendered hardware pass

Correction commit: `75bcd908d05752d573eedd55587c244f1076e270` (branch `main`).
Packaged build: `6acb3752329886d0b91da3ee2f58a371e35c5c6d` - the same code plus
this release documentation, and what `BUILD_INFO.json` inside the worker ZIP
reads. Corrects `8f3568a`; see `RELEASE-8f3568a.md` for everything else that
build shipped.

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
bash scripts/deploy-production.sh 6acb3752329886d0b91da3ee2f58a371e35c5c6d
```

## Replacement worker package

The `8f3568a` worker ZIP is superseded. Do not install it.

| | |
|---|---|
| File | `/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-6acb375.zip` |
| SHA-256 | `0da3dec46a1292db1b5975035776561d2496c47a10150358d96510fc059f1599` |
| Size | 860,152 bytes |
| Build commit | `6acb3752329886d0b91da3ee2f58a371e35c5c6d` (in `worker-app/BUILD_INFO.json`) |
| Installer | `DYO-Worker-SlotSemantics-Update.ps1` (unchanged in behaviour) |

```powershell
scp fahad@169.58.48.14:/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-6acb375.zip "$env:USERPROFILE\Downloads\DYO-SS2.zip"
$e="0da3dec46a1292db1b5975035776561d2496c47a10150358d96510fc059f1599"
$a=(Get-FileHash "$env:USERPROFILE\Downloads\DYO-SS2.zip" -Algorithm SHA256).Hash.ToLower()
if($a -ne $e){Write-Host "MISMATCH - STOP. $a"}else{
 Expand-Archive "$env:USERPROFILE\Downloads\DYO-SS2.zip" "$env:USERPROFILE\Downloads\DYO-SS2" -Force
 cd "$env:USERPROFILE\Downloads\DYO-SS2"
 powershell -NoProfile -ExecutionPolicy Bypass -File ".\DYO-Worker-SlotSemantics-Update.ps1"
 Write-Host ("build commit: " + (Get-Content "C:\DYO-Agent\app\BUILD_INFO.json" -Raw))
}
```

`BUILD_INFO.json` must read `6acb375…` afterwards. Everything else about the
install - what it preserves, its backup and automatic rollback - is unchanged
from `RELEASE-8f3568a.md`.

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

| | |
|---|---|
| File | `/home/fahad/windows-worker-releases/DYO-QA-Smoke-Fixture-6acb375.zip` |
| SHA-256 | `dc27767826e155c0bbaf9f95a22fec476796aed9f8eb65d729c7606734357b78` |
| Size | 94,972 bytes (17 entries, including the 12 sequence frames) |
| Extracts to | `C:\DYO-Agent\qa\smoke-75bcd90` |

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
