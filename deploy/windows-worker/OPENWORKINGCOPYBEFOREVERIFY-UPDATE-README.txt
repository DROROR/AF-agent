DYO WINDOWS WORKER - OPEN WORKING COPY BEFORE VERIFY FIX UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-OpenWorkingCopyBeforeVerify-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original setup, or its saved registration was removed - use
the full DYO Worker setup package instead of this one in that case.

WHAT THIS FIXES
-------------------
A Create Complete Preview job failed with a confusing error
("aeProjectItemIndex 3 does not resolve to any composition in this
project") because After Effects was actually sitting on its own
Untitled/Home screen with no project open at all - the check that
resolves which composition to render never actually confirmed the
correct project was open first, it just asked AE about whatever
happened to already be open.

This update fixes that: before Complete Preview or the final Render ever
looks up a composition or starts rendering, it now explicitly makes sure
the correct session working copy is open in After Effects and checks
that AE agrees - if it isn't (or nothing is open), the job now fails
immediately with a clear, honest message instead of a confusing one, and
never renders the wrong thing.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- The original, immutable source project file - this fix has no way to
  even reach it; it only ever opens the session's own working copy.
- No After Effects project is opened, changed, or run against by this
  UPDATE ITSELF - it only updates program files and restarts DYO Worker,
  which then reports its normal status on its own. The fixed check only
  runs the next time the dashboard dispatches Complete Preview or final
  Render.
- Any scene-editing or asset-mapping operation - this update has nothing
  to do with either of them.
