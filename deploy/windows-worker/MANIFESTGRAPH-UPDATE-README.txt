DYO WINDOWS WORKER - PREVIEW TIMING MANIFEST GRAPH UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-ManifestGraph-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS UPDATES
-------------------
Fixes "Analyze Preview Timing" incorrectly reporting that a mapped layer
is "not reachable" on templates where the master timeline composition has
many layers. The dashboard now already knows (from the project's own
existing data) which composition it expects a layer to lead to - this
update lets the Worker's own scan stop the instant it finds that one
composition, instead of checking every remaining layer, avoiding the
slow scan that caused the incorrect result. This update does not run any
inspection itself - it only installs the capability.

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
- Any scene-editing or asset-mapping operation - this update has nothing
  to do with any of them, and never runs them.
