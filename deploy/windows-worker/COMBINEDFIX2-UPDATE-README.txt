DYO WINDOWS WORKER - COMBINED FIX UPDATE #2
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-CombinedFix2-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original setup, or its saved registration was removed - use
the full DYO Worker setup package instead of this one in that case.

WHAT THIS UPDATES (both together, in one package)
-----------------------------------------------------
1. When Inspect Template cannot open a project because After Effects
   needs you to confirm a one-time dialog (most commonly converting an
   older-version project, or acknowledging a missing font/plugin
   warning), it now says so clearly and automatically prepares a safe,
   disposable copy of that project for you to open and confirm - instead
   of a generic, confusing error. Works for any template, not just one
   specific file.
2. Restarting DYO Worker (during an update, or manually) can no longer
   leave an old copy of DYO Worker running alongside a new one - it now
   always checks for, and safely stops, any leftover copy before
   starting the new one.

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
