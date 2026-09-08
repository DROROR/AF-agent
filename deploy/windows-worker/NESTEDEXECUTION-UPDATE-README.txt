DYO WINDOWS WORKER - NESTED EXECUTION UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-NestedExecution-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.
4. Check Task Manager afterward - there should be exactly ONE node.exe
   process for the DYO Video Worker task. If you see more than one, run
   DYO-Worker-Stop.bat then DYO-Worker-Start.bat once to clean it up.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS UPDATES
-------------------
- Adds real execution support for a human-added mapping (a mapping DYO
  creates through the dashboard with a real, verified AE target but no
  automatically-detected placeholder of its own) - both a direct,
  same-composition target and a nested target that descends through one
  or more precomp compositions before reaching the real layer (for
  example, a logo or branding-text layer several levels deep inside a
  template). This update does not run any edit itself - it only installs
  the capability; DYO's own dashboard/API decides when to actually use it.

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
