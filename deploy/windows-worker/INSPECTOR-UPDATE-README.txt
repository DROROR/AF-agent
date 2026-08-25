DYO WINDOWS WORKER - MCP + INSPECTOR UPDATE
==============================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-Inspector-Update.bat
3. Done - it updates the program files, installs one new small runtime
   component, checks ae-mcp's status once, and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS UPDATES
-------------------
- DYO Worker now checks ae-mcp's status using ae-mcp's own official
  command, instead of an older method.
- Adds the ability for DYO Worker to later read basic, read-only
  information from an open After Effects project (composition names,
  project info) once that capability is turned on for your account -
  nothing is enabled or run automatically by this update.
- One small new runtime component this capability needs (the official
  Model Context Protocol library) is installed alongside the existing
  program files.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- No After Effects project is opened, changed, or run against by this
  update, or by anything it installs.
