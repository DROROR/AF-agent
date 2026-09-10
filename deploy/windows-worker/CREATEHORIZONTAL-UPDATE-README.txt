DYO WINDOWS WORKER - LANDSCAPE OUTPUT COMPOSITION UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-CreateHorizontal-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS UPDATES
-------------------
Adds the ability to build a real 1920x1080 Landscape output composition
from a project's own currently-approved content, with elements
repositioned for horizontal presentation rather than a crop. This update
does not build anything itself - it only installs the capability; the
dashboard's own "Build Landscape Master" button is what actually triggers
a build, on demand.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- No After Effects project is opened, changed, or run against by this
  update, or by anything it installs. Nothing in this update ever asks
  ae-mcp to do anything - it only updates program files and restarts
  DYO Worker, which then reports its normal status on its own.
- Any other scene-editing or asset-mapping operation - this update has
  nothing to do with any of them, and never runs them.
