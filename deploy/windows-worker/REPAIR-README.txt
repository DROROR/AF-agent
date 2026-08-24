DYO WINDOWS WORKER - REPAIR / UPDATE
=====================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-Repair.bat
3. Done - it updates the program files, fixes a couple of configuration
   details, restarts automatic startup, and starts DYO Worker again, all
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS UPDATES
-------------------
- The DYO Worker program files themselves (bug fixes).
- The After Effects path DYO Worker uses to report status.
- Where DYO Worker looks for ae-mcp's status file (now based on your own
  Windows user account, not a placeholder that never matched a real
  computer).
- The "DYO Video Worker" automatic-startup entry.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
