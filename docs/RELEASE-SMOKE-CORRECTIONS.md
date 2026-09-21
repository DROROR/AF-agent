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

Built from `e78dbf41ecd2c761fe9378e012dae5feb60a8068`.

| | Worker | QA fixture |
|---|---|---|
| File | `/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-e78dbf4.zip` | `/home/fahad/windows-worker-releases/DYO-QA-Smoke-Fixture-v4.zip` |
| SHA-256 | `384e2e406aa5598fe72c374c156b7176c502899cbfe16fd9faac5bdffbc78385` | `441f38109612c2b37f91075542fd82ce45343a283b93b724d1bdecadbd911721` |
| Size | 860,797 bytes | 96,381 bytes |

The worker is unchanged since `e78dbf4` - if it is already installed, only the
fixture below needs replacing.

```powershell
# Worker
scp fahad@169.58.48.14:/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-e78dbf4.zip "$env:USERPROFILE\Downloads\DYO-SS3.zip"
$e="384e2e406aa5598fe72c374c156b7176c502899cbfe16fd9faac5bdffbc78385"
$a=(Get-FileHash "$env:USERPROFILE\Downloads\DYO-SS3.zip" -Algorithm SHA256).Hash.ToLower()
if($a -ne $e){Write-Host "MISMATCH - STOP. $a"}else{
 Expand-Archive "$env:USERPROFILE\Downloads\DYO-SS3.zip" "$env:USERPROFILE\Downloads\DYO-SS3" -Force
 cd "$env:USERPROFILE\Downloads\DYO-SS3"
 powershell -NoProfile -ExecutionPolicy Bypass -File ".\DYO-Worker-SlotSemantics-Update.ps1"
 Write-Host ("build commit: " + (Get-Content "C:\DYO-Agent\app\BUILD_INFO.json" -Raw))
}

# QA fixture (new folder - the broken one is never reused)
scp fahad@169.58.48.14:/home/fahad/windows-worker-releases/DYO-QA-Smoke-Fixture-v4.zip "$env:USERPROFILE\Downloads\DYO-QA-v3.zip"
$e="441f38109612c2b37f91075542fd82ce45343a283b93b724d1bdecadbd911721"
$a=(Get-FileHash "$env:USERPROFILE\Downloads\DYO-QA-v3.zip" -Algorithm SHA256).Hash.ToLower()
if($a -ne $e){Write-Host "MISMATCH - STOP. $a"}else{
 New-Item -ItemType Directory -Force -Path "C:\DYO-Agent\qa\smoke-fixture-v4" | Out-Null
 Expand-Archive "$env:USERPROFILE\Downloads\DYO-QA-v3.zip" "C:\DYO-Agent\qa\smoke-fixture-v4" -Force
}
```

`BUILD_INFO.json` must read `e78dbf4…` after the worker install.

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

Rolling the worker back to the previous package returns it to the build whose
verdicts are all `unknown` - fail-closed, so nothing can be approved on a bad
verdict, but nothing can be approved at all either.

**Server.** No server change is required by these corrections: the classifier
lives in the worker, and the model version is unchanged at v2. The currently
deployed build (`dc14516`) stays as it is. If it is ever rolled back, use the
previous release directory that is still on disk, exactly as
`RELEASE-8f3568a.md` describes.

**Fixture.** Delete `C:\DYO-Agent\qa\smoke-fixture-v4` and extract the ZIP
again; the builder refuses to overwrite an existing QA project, so a clean
folder is always the way back.
