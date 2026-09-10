DYO WINDOWS WORKER - FULL-DURATION RENDER FIX UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-FullDurationRender-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS FIXES
-------------------
Complete Preview was rendering and playing successfully, but ended early
- visible content stopped well before the end of the approved master
timeline. The composition timeline diagnostics update (installed earlier)
proved the composition's own real duration is 45.045 seconds, but the AE
project's own "work area" marker is only 31.7317 seconds - and without an
explicit instruction otherwise, the render only covered the work area.

This update makes Complete Preview and final Render always render the
FULL composition duration - the entire approved master timeline, not just
the work area - computed automatically from the composition's own real
duration each time, with no dashboard action needed beyond the normal
"Generate Complete Preview" / render buttons.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- No After Effects project is opened, changed, or run against by this
  update, or by anything it installs. Nothing in this update ever asks
  ae-mcp or aerender to do anything - it only updates program files and
  restarts DYO Worker, which then reports its normal status on its own.
  The corrected render itself only happens the next time the dashboard
  dispatches Complete Preview or final Render.
- Any scene-editing or asset-mapping operation - this update has nothing
  to do with either of them.
