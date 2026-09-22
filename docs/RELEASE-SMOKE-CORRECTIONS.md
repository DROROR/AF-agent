# Smoke-test corrections to Stage 4 (2026-09-21)

Two defects the first real After Effects smoke test found, corrected here. Not
a new stage: both are Stage 4 work that was wrong.

## 1. The scan never reached the classifier (product)

`buildProjectFacts()` accepted `layerFactsByCompositionAndIndex`, used it
internally, and **did not return it**. `build-manifest.ts` then read
`facts.layerFactsByCompositionAndIndex` and always got `undefined`, so every
lookup in `build-slot-facts.ts` missed. In production that meant:

- every host fact null - `enabled`, `threeDLayer`, `parentIsAnimated`,
  `windowSeconds`, `inFrame`;
- every `matteSource` `UNKNOWN`;
- every visual slot `unknown`, confidence `0.000`, needing a human.

The field was optional on both sides, so TypeScript said nothing, and every
slot unit test built the map itself and called `buildSlotStructuralFacts`
directly - so 4,075 tests passed against a feature that did nothing.

**The fix.** `buildProjectFacts` returns it, and the contract is now REQUIRED on
`BuildProjectFactsInput`, `ProjectFacts`, `SlotFactsInput` and the two internal
manifest signatures. A scan that did not run is an **empty map, passed
explicitly** - never an absent field. The production call site passes
`new Map()` when the preflight scan failed, which the manifest already reports
as an `unknownItems` warning.

**The test that would have caught it.** `apps/worker/src/inspection/__tests__/scan-to-slot-verdict.integration.test.ts`
runs the real chain - raw scan JSON → `parseProjectPreflightScan` →
`buildProjectFacts` → `buildTemplateManifest` → slot verdicts - and asserts the
map survives it, that host facts are genuinely populated rather than a row of
nulls, that a real verdict is reached, and that a moving-footage matte and an
imported-still matte produce **different** `matteSource` values end to end. A
fifth case pins the empty-scan path: a manifest is still built, and every slot
honestly says it cannot be classified.

## 2. The QA fixture bound no mattes (fixture)

On After Effects 2023+, assigning `layer.trackMatteType` sets a mode without
binding a matte LAYER. The fixture did exactly that, so After Effects reported
`hasTrackMatte: false` and `trackMatteLayer: null` on every host - a project
with matte modes and no mattes, which could not exercise the screen-versus-card
distinction even with defect 1 fixed.

**The fix.** Each matte is bound with `setTrackMatte(matteLayer, type)` (with
the pre-2023 fallback, matte moved directly above its host), and then
**verified**: `hasTrackMatte` must be true and the bound layer must be the exact
one intended. If After Effects does not confirm it, the script stops and saves
nothing. Every previous refusal is unchanged: a saved project open, unsaved
changes, a non-empty untitled project, running from the wrong folder, an
existing `QA-Smoke.aep`, missing footage, or the hardware sequence importing as
a still.

The corrected fixture extracts to a new folder each time one is corrected, so a
broken one cannot be reused by accident. Current: **`C:\DYO-Agent\qa\smoke-fixture-v4`**.

### 2b. The two control cases shared one slot (fixture, second smoke run)

v3 pointed `QA_ScreenHost` and `QA_StillMattedHost` at the same `QA_Screen`
composition. Two hosts of the same slot are two hosts of ONE slot: the
classifier saw them disagree and reported a single conflicting verdict
(`device_screen`, confidence 0.613, conflicting) - correct behaviour, but it
meant the moving-matte and still-matte cases could not be told apart, which is
the one thing that pair exists to show.

**The fix.** `QA_StillMattedHost` now places its own `QA_ScreenStill`
composition, identical but for its identity, so each case gets its own verdict:
a confident `device_screen` from the moving sequence, and a conflicting one
needing a human from the still image. The integration test pins both halves,
including the shared-slot collapse as a regression.

**Nothing in the product changed for this**, so the worker package built from
`e78dbf4` stays correct and is not rebuilt.

## 3. The live fingerprint check spoke a different enum vocabulary (product, third smoke run)

The first real frame execution was refused before it touched anything:

> operation 0 (MAP_FOOTAGE) refused: this slot's structure has changed since
> the plan was approved (approved `4e01d1de4315`, now `6a712b80a57b`)

Nobody had touched the project. The stored fingerprint comes from the project
SCAN, which records a track matte by its documented KEY NAME (`"LUMA"`,
`"NO_TRACK_MATTE"`). The live re-check in `buildDescribeChainStructureScript`
stringified After Effects' enum object instead, producing its raw numeric form
(`"6015"`). The same fact, encoded two ways, so the two digests could never be
equal - **every footage edit, on every slot, in every project, was refused**.
Fail-closed, so nothing was ever edited wrongly; nothing could be edited at
all either.

No unit test could catch it: each side was only ever tested against itself.

**The fix.** The chain script embeds the scan's own enum helper and the same
documented key list (`TRACK_MATTE_TYPE_KEYS`), so both sides encode the fact
identically. Three regression tests run the real generated script: a bound
matte must read `LUMA`, an unmatted layer `NO_TRACK_MATTE`, and never a
numeric string.

## 4. The live fingerprint check found compositions by an unstable index (product, fourth smoke run)

With defect 3 fixed, operations 0 and 1 applied for the first time - and
operation 2 was refused:

> operation 2 (MAP_FOOTAGE) refused: the slot's live structure could not be
> read, so it could not be proven unchanged since approval (chain step 0 did
> not resolve to a composition)

A project-item index is **not stable within a single job**. Operation 0 is a
`MAP_FOOTAGE`; importing its asset renumbers `app.project.item(n)`. By the time
the next nested slot's re-check looked up its composition by the index the plan
recorded at approval time, that index held imported footage.

The mutation path already knew this. `wrapNestedScript` learned it on
2026-09-14 and resolves every step by the stable `CompItem.id`;
`buildDescribeChainStructureScript`, written later for the Stage 4 re-check,
still trusted the index. So on any scene whose first operation imports
footage - which is nearly every scene - every LATER nested slot was refused.

**The fix.** Both paths now identify a composition the same way: scan for its
own AE id, require exactly one match, and treat the stored index only as a hint
in the failure message. Descending through a hop becomes a VERIFICATION - the
hop's source composition must be the one the next step names - rather than the
way the next composition is found, matching `wrapNestedScript` exactly. Five
regression tests run the real generated script against a project whose item
order does not match the stored hints.

### 4b. The installer reported a hard-coded build (installer)

The `06df85a` install printed "DYO Worker is running build 8f3568a" while the
`BUILD_INFO.json` beside it correctly read `06df85a…` - the one sentence an
operator reads to confirm an install was the one sentence that could not be
trusted. The installer now reads the commit out of the installed
`BUILD_INFO.json` and reports that, and says so plainly when it cannot.

## Model version: kept at `slot-semantics-v2`

Queried before deciding. Only the QA project carries v2 verdicts:

| Project | Slot verdicts | Model version |
|---|---|---|
| `test 22מ`, `t`, `Mixkit Smartphone Promo`, `Mixkit Smartphone Promo Final` | none | - |
| `QA-Smoke.` (`400392fa-1109-477d-a16e-ce57b77142e3`) | yes | `slot-semantics-v2` |

No real manifest was produced under v2, and only one job result (`5cd895ee…`,
the QA inspection) contains any. So the version stays at **v2** and no bump is
needed.

**The QA project must be discarded and recreated.** Project
`400392fa-1109-477d-a16e-ce57b77142e3` holds a manifest built while the scan was
being dropped: every slot in it is `unknown` / `0.000` with no facts. It is not
salvageable by re-reading - it must be deleted in the dashboard and re-created
from the corrected fixture. It has NOT been deleted here.

## Artifacts

Neither is deployed or installed here.

Worker built from `6dace9ec46ba76710cb058fec77f37af95d73a4e`; QA fixture v4
unchanged since `e78dbf4`.

| | Worker | QA fixture |
|---|---|---|
| File | `/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-6dace9e.zip` | `/home/fahad/windows-worker-releases/DYO-QA-Smoke-Fixture-v4.zip` |
| SHA-256 | `c82e51086f51124c85d33adfee32b42f53f14d275d8fa9e2253dfd25afaa5cc5` | `441f38109612c2b37f91075542fd82ce45343a283b93b724d1bdecadbd911721` |
| Size | 862,476 bytes | 96,381 bytes |

Superseded worker packages - do not install: `e78dbf4`, `06df85a`.

```powershell
# Worker
scp fahad@169.58.48.14:/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-6dace9e.zip "$env:USERPROFILE\Downloads\DYO-SS5.zip"
$e="c82e51086f51124c85d33adfee32b42f53f14d275d8fa9e2253dfd25afaa5cc5"
$a=(Get-FileHash "$env:USERPROFILE\Downloads\DYO-SS5.zip" -Algorithm SHA256).Hash.ToLower()
if($a -ne $e){Write-Host "MISMATCH - STOP. $a"}else{
 Expand-Archive "$env:USERPROFILE\Downloads\DYO-SS5.zip" "$env:USERPROFILE\Downloads\DYO-SS5" -Force
 cd "$env:USERPROFILE\Downloads\DYO-SS5"
 powershell -NoProfile -ExecutionPolicy Bypass -File ".\DYO-Worker-SlotSemantics-Update.ps1"
 Write-Host ("build commit: " + (Get-Content "C:\DYO-Agent\app\BUILD_INFO.json" -Raw))
}
```

`BUILD_INFO.json` must read `6dace9e…` after the worker install, and the
installer's own closing line must now name that same commit.

The QA fixture is unchanged: if `C:\DYO-Agent\qa\smoke-fixture-v4\QA-Smoke.aep`
already exists (sha256 `c1e1e4ea5663975cea9066501a885d96fd10bbdd4eee2dffe9cf3b895222bd51`),
nothing needs re-extracting.

### Rollback

**Worker.** The installer backs up `dist` and `BUILD_INFO.json` together before
replacing them and restores both automatically if the worker does not come back
healthy. By hand afterwards:

```powershell
Stop-ScheduledTask -TaskName "DYO Video Worker"
$b = Get-ChildItem "C:\DYO-Agent\app" -Directory -Filter "dist.backup-*" | Sort-Object Name -Descending | Select-Object -First 1
Remove-Item "C:\DYO-Agent\app\dist" -Recurse -Force
Copy-Item $b.FullName "C:\DYO-Agent\app\dist" -Recurse -Force
if (Test-Path "$($b.FullName).BUILD_INFO.json") { Copy-Item "$($b.FullName).BUILD_INFO.json" "C:\DYO-Agent\app\BUILD_INFO.json" -Force }
Start-ScheduledTask -TaskName "DYO Video Worker"
```

Rolling back returns the worker to a build that refuses every footage edit
(defect 3) or every nested slot after the first import (defect 4) - fail-closed
in both cases, so nothing can be approved on a bad verdict, but nothing can be
executed either.

**Server.** No server change is required by any of these corrections: the
classifier and both re-check scripts live in the worker, and the model version
is unchanged at v2. The currently deployed build (`dc14516`) stays as it is. If
it is ever rolled back, use the previous release directory that is still on
disk, exactly as `RELEASE-8f3568a.md` describes.

**Fixture.** Delete `C:\DYO-Agent\qa\smoke-fixture-v4` and extract the ZIP
again; the builder refuses to overwrite an existing QA project, so a clean
folder is always the way back.
