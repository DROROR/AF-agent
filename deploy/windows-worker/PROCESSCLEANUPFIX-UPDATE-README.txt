DYO WINDOWS WORKER - PROCESS CLEANUP FIX UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-ProcessCleanupFix-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original setup, or its saved registration was removed - use
the full DYO Worker setup package instead of this one in that case.

WHAT THIS FIXES
-----------------------------------------------------
A real 2026-09-11 incident: after a routine update, this machine was found
running TWO independent copies of DYO Worker at once - an old one left
over from an earlier restart, alongside the new one. Windows' own Task
Scheduler can lose track of a still-running task instance, so asking it
to "stop" the old one silently did nothing, and asking it to "start" a
new one created a second, separate copy instead of replacing the first.

This update makes every future restart forcibly check for, and stop, any
leftover copy of DYO Worker BEFORE starting a new one - regardless of
what Windows' own Task Scheduler believes is running - so a restart can
never again leave two copies running side by side. It only ever stops
processes that are exactly this DYO Worker program (by their own real
startup command) - it never touches After Effects, Adobe Creative Cloud,
or anything else running on this computer.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- The original, immutable source project file - never opened or changed.
- No After Effects project is opened, changed, or run against by this
  UPDATE ITSELF - it only updates program files and restarts DYO Worker,
  which then reports its normal status on its own.
- Any asset-mapping or scene-approval decision - completely unaffected.
- After Effects, Adobe Creative Cloud, or ae-mcp - this update never
  stops any process other than DYO Worker's own two known processes.
