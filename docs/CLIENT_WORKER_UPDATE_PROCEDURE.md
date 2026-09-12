# Client Worker Update Procedure (DESKTOP-A629N4N)

**Status: PREPARED, NOT YET AUTHORISED TO RUN.** This procedure must not be
executed until the QA cold-reboot acceptance test on FAHADNAKASH has passed
(see `ACCEPTANCE.md` → "Startup & recovery acceptance"). The client machine
is deliberately left untouched until then.

## What this update changes

It removes the daily manual step where somebody had to open After Effects
and click CONNECT in the ae-mcp panel after every Windows restart before any
job could run.

1. **After Effects starts automatically** when a job needs it and it is not
   already running, from the `AE_PATH` this machine's own setup already
   validated. Bounded: never when AE is already running, never on an
   inconclusive check, at most one attempt per cooldown window and a capped
   total, after which it reports an explicit reason (licensing/sign-in
   prompt, or a blocking dialog are the usual causes) instead of retrying
   forever.
2. **The MCP health check now performs a real round trip** instead of
   judging the bridge by a command-line exit code under an 8-second ceiling.
   That ceiling was reporting a genuinely healthy, connected bridge as
   "unknown", which blocked every job indefinitely. It only ever reports a
   healthy connection when it has genuinely confirmed one.
3. **The same 8-second problem is fixed for Check Health.**

The Worker already started automatically at Windows logon before this
update (its Scheduled Task is registered `-AtLogOn` with `RestartCount 999`);
that part was already correct and is unchanged.

## What is preserved, and how that is guaranteed

| Preserved | Guarantee |
|---|---|
| Worker identity (`WORKER_ID`/`WORKER_TOKEN`) | The installer never reads, writes or passes them, and never opens `worker-credentials.json` — it only checks the file exists. If it is missing the installer **stops** rather than silently registering a duplicate worker. |
| `.env` (`DYO_API_URL`, `AE_PATH`, `AE_MCP_PATH`, `AERENDER_PATH`, `WORK_ROOT`) | Explicitly excluded from the file copy and never rewritten. |
| Job history | Lives server-side in PostgreSQL, entirely untouched by any Worker-side install. The client Worker's existing 69 jobs are unaffected. |
| ae-mcp install, panel and settings | Never touched. |
| Scheduled Task registration | Restarted, never re-registered (`Register-ScheduledTask`/`Unregister-ScheduledTask` appear nowhere in the installer). |

Each row above is enforced by a regression test in
`scripts/windows-worker/__tests__/dyo-worker-startuprecovery-update.test.ts`,
which fails the build if any of them regresses.

## Safety behaviour during install

- The Worker is **fully stopped and its exit positively verified** before any
  program file is replaced. If it cannot be stopped, the installer **aborts
  having changed nothing**, and restarts the existing Worker before exiting.
- Only processes confirmed to still be this Worker are ever stopped:
  matched by PID **plus creation time plus `node.exe` plus this Worker's own
  command lines**, behind a hard `PID <= 4` floor. (A previous version
  matched on PID alone and, after Windows recycled a PID, attempted to
  terminate a system process — hence the identity check.)
- After copying, the installer **proves the new files physically landed**
  before restarting anything or claiming success.
- **Rollback:** the current `dist` and `BUILD_INFO.json` are backed up
  together before replacement. If the Worker does not come back up healthy
  (exactly one supervisor plus a real worker child, polled for up to 120s),
  both are restored and the Worker restarted automatically.

## Procedure

Run on DESKTOP-A629N4N, signed in as the same Windows user that installed
the Worker originally:

```powershell
scp fahad@169.58.48.14:/home/fahad/windows-worker-releases/DYO-QA-Worker-StartupRecovery-Update.zip "$env:USERPROFILE\Downloads\DYO-SR.zip"
$e="<SHA256 from the release notes>"
$a=(Get-FileHash "$env:USERPROFILE\Downloads\DYO-SR.zip" -Algorithm SHA256).Hash.ToLower()
if($a -ne $e){Write-Host "MISMATCH - STOP. $a"}else{
 Expand-Archive "$env:USERPROFILE\Downloads\DYO-SR.zip" "$env:USERPROFILE\Downloads\DYO-SR" -Force
 cd "$env:USERPROFILE\Downloads\DYO-SR"
 powershell -NoProfile -ExecutionPolicy Bypass -File ".\DYO-Worker-StartupRecovery-Update.ps1"
 Write-Host ("probe:    " + (Test-Path "C:\DYO-Agent\app\dist\health\ae-mcp-round-trip-adapter.js"))
 Write-Host ("launcher: " + (Test-Path "C:\DYO-Agent\app\dist\health\ensure-ae-running.js"))
}
```

The two final lines are an independent check, deliberately outside the
installer, so they cannot be fooled by the installer's own reporting.

## Post-install acceptance on the client machine

1. Both independent checks print `True`.
2. Dashboard shows the client Worker: Worker ONLINE, AE ONLINE, MCP ONLINE.
3. Restart Windows, log in, and **do not open After Effects or touch the
   ae-mcp panel**. Within a few minutes all three must return to ONLINE on
   their own. After Effects opening by itself is the fix working.
4. Dispatch one real CHECK_HEALTH and confirm it succeeds.
5. Dispatch one real job and confirm it completes.
6. Confirm the client Worker's job history is intact and its identity
   unchanged (same worker row, same ID — no new worker appears).

Do not proceed past step 1 if either check prints `False`; the rollback will
already have restored the previous working state.
