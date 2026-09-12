DYO WINDOWS WORKER - STARTUP & RECOVERY UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-StartupRecovery-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically.

WHAT THIS FIXES
-----------------------------------------------------
Until now, after a Windows restart somebody had to open After Effects by
hand and click CONNECT in the ae-mcp panel before any job could run.
That is no longer necessary:

1. If After Effects is not running when it is needed, DYO Worker now
   starts it automatically. It will never open a second copy, and if
   After Effects genuinely cannot start (for example a licensing or
   sign-in prompt is waiting), it stops trying and says so clearly
   instead of retrying forever.
2. The connection check to After Effects was previously giving up after
   8 seconds and reporting "unknown" even when the bridge was perfectly
   healthy - which blocked every job. It now waits properly and only
   reports a healthy connection when it has genuinely confirmed one.
3. The same 8-second problem is fixed for the Check Health action.

DYO Worker already started automatically when you log in to Windows;
that part was already working and is unchanged.

IF SOMETHING GOES WRONG (ROLLBACK)
-----------------------------------
This update backs up your current program files before replacing them,
then checks that DYO Worker actually came back up. If it did not, the
update automatically restores the backup and restarts DYO Worker, so the
computer is never left in a worse state than before you ran it.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- The original, immutable source project file - never opened or changed.
- Your ae-mcp installation, its panel, or its settings.
- Any asset-mapping or scene-approval decision - completely unaffected.
