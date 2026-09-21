# Release 8f3568a - safe inspections, slot semantics, measured asset facts

Build commit: `8f3568a104a6dfb5c14a0497710058249ea9256f` (branch `main`).

Everything below was produced from that exact commit. Server components are
deployed; the Windows worker is packaged and published but **deliberately not
installed** - the operator installs it.

## What shipped

| Component | State |
|---|---|
| `@dyo/schemas` | built and deployed (API and dashboard consume it) |
| API (`dyo-api`) | deployed, running from `/opt/AF-agent` at this commit |
| Dashboard (`dyo-web`) | deployed, release `8f3568a…` served via `/home/fahad/dyo-web-releases/current` |
| Database | migrations through `0026` applied |
| Windows worker | **packaged, published, NOT installed** |

## Database

- Backup / rollback point: `/home/fahad/db-backups/dyo_video_agent-pre-8f3568a-20260921T091228Z.dump`
  (pg_dump custom format, 323,530 bytes, sha256
  `d1636172313d4451f987573b553a56a465288dde69179cff1137fa2e8e57c6fb`).
  Verified by restoring it into a disposable cluster: every table's row count
  matched production exactly.
- Migrations `0025_cynical_proudstar` (adds the measured-asset columns) and
  `0026_glossy_toro` (drops the superseded `has_alpha`) were validated by
  replaying them on that restored copy and diffing the result against
  production: 196 columns identical, migration journal identical, every
  unrelated table byte-identical.

### `has_alpha` was deployed, and is now dropped

`0023_talented_warpath`, which adds `assets.has_alpha`, was applied to
production on **2026-09-19 17:01:37 UTC**. It was dropped again by `0026` on
**2026-09-21 07:09:45 UTC**. No data was lost: every asset in this database was
uploaded between 2026-09-02 and 2026-09-14, before any measurement existed, so
the column never held a value.

## Windows worker package

| | |
|---|---|
| File | `/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-8f3568a.zip` |
| Size | 858,779 bytes |
| SHA-256 | `c84a91be9ead2d1db5e8b7ea43ec2e5fd144a2bdfdd0436a42ec57f33f5dd728` |
| Build commit | `8f3568a104a6dfb5c14a0497710058249ea9256f` (also in `worker-app/BUILD_INFO.json` inside the ZIP) |
| Installer | `DYO-Worker-SlotSemantics-Update.ps1` (+ `.bat` launcher, README) |

The package contains compiled JavaScript only - no TypeScript sources, no
tests, no `.env`, no credentials.

### Operator commands (run on the worker machine, as the user that installed it)

```powershell
scp fahad@169.58.48.14:/home/fahad/windows-worker-releases/DYO-QA-Worker-SlotSemantics-8f3568a.zip "$env:USERPROFILE\Downloads\DYO-SS.zip"
$e="c84a91be9ead2d1db5e8b7ea43ec2e5fd144a2bdfdd0436a42ec57f33f5dd728"
$a=(Get-FileHash "$env:USERPROFILE\Downloads\DYO-SS.zip" -Algorithm SHA256).Hash.ToLower()
if($a -ne $e){Write-Host "MISMATCH - STOP. $a"}else{
 Expand-Archive "$env:USERPROFILE\Downloads\DYO-SS.zip" "$env:USERPROFILE\Downloads\DYO-SS" -Force
 cd "$env:USERPROFILE\Downloads\DYO-SS"
 powershell -NoProfile -ExecutionPolicy Bypass -File ".\DYO-Worker-SlotSemantics-Update.ps1"
 Write-Host ("disposable-project: " + (Test-Path "C:\DYO-Agent\app\dist\inspection\disposable-project.js"))
 Write-Host ("slot-facts:         " + (Test-Path "C:\DYO-Agent\app\dist\inspection\build-slot-facts.js"))
 Write-Host ("slot-semantics:     " + (Test-Path "C:\DYO-Agent\app\schemas\dist\slot-semantics.js"))
 Write-Host ("build commit:       " + (Get-Content "C:\DYO-Agent\app\BUILD_INFO.json" -Raw))
}
```

The four final lines are an independent check, deliberately outside the
installer, so they cannot be fooled by the installer's own reporting. All three
`Test-Path` lines must print `True` and the build commit must read `8f3568a…`.

**Do not open After Effects, and do not run any job, while the installer runs.**

## Rollback

**Worker.** The installer backs up `dist` and `BUILD_INFO.json` together before
replacing anything and restores them automatically if the worker does not come
back healthy. To roll back by hand afterwards:

```powershell
Stop-ScheduledTask -TaskName "DYO Video Worker"
$b = Get-ChildItem "C:\DYO-Agent\app" -Directory -Filter "dist.backup-*" | Sort-Object Name -Descending | Select-Object -First 1
Remove-Item "C:\DYO-Agent\app\dist" -Recurse -Force
Copy-Item $b.FullName "C:\DYO-Agent\app\dist" -Recurse -Force
if (Test-Path "$($b.FullName).BUILD_INFO.json") { Copy-Item "$($b.FullName).BUILD_INFO.json" "C:\DYO-Agent\app\BUILD_INFO.json" -Force }
Start-ScheduledTask -TaskName "DYO Video Worker"
```

**Server code.** The previous dashboard release stays on disk; switch back with
`scripts/switch-web-release.sh <previous-sha>` and `pm2 startOrReload … --only
dyo-api` after checking out that commit. `deploy-production.sh` refuses to roll
code back automatically across a schema change, by design.

**Database.** Restore the backup above into a fresh database and repoint
`DATABASE_URL`:

```bash
createdb dyo_video_agent_restore
pg_restore -d dyo_video_agent_restore --no-owner --no-privileges \
  /home/fahad/db-backups/dyo_video_agent-pre-8f3568a-20260921T091228Z.dump
```

Rolling the schema back in place is not needed for this release: `0025` only
adds nullable columns and `0026` drops a column that never held data, so the
previous API build runs unchanged against the current schema.

## Verification performed

- `npm run typecheck` clean; `npm run lint` clean.
- Complete suite: 316 files, 4,068 tests, 0 failures - including the 16
  regression tests added with this release for its own installer.
- `GET /health/live` → `{"status":"ok"}`; `GET /health/ready` →
  `{"status":"ok","database":"ok"}`.
- Dashboard `/login` returns 200 and all 12 referenced static assets resolve.
- API error log has no entries from this release.

## Not done here, on purpose

- The Windows worker is **not** installed. No AE project was opened, inspected,
  modified or rendered.
- The client project `65e24d16…`, its approved Revision 4 and session
  `e0483ad6…` were not touched: no job was dispatched for that project, and no
  Revision 5 exists.
- The first real AE smoke test uses a purpose-built disposable QA project -
  see `AE-SMOKE-TEST-8f3568a.md`.
