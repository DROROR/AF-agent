DYO WINDOWS WORKER - CHECK_HEALTH UPDATE (REMOTE DIAGNOSTICS)
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-CheckHealth-Update.bat
3. Done - it stops DYO Worker safely, updates the program files, restarts
   it, and proves the restart actually worked before saying so. No
   terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS UPDATES
-------------------
- Adds CHECK_HEALTH - a remote diagnostic job DYO can dispatch to see
  exactly why After Effects / ae-mcp status disagrees with what is
  expected, without needing you to do anything on this computer. It only
  ever runs two fixed, already-approved checks (an AE process check, and
  ae-mcp's own official "health" command) - never an arbitrary command.
- Also ships the current read-only template inspection feature
  (unchanged from whatever DYO has already deployed).
- This update does not run any diagnostic or inspection itself - it only
  installs the capability so DYO can request it later.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- No After Effects project is opened, changed, or run against by this
  update, or by anything it installs.

IF IT SAYS "NEEDS ATTENTION"
------------------------------
This update actively verifies each step - including that DYO Worker
genuinely stopped before files were changed, and that a real new process
with a real successful heartbeat is running afterward - rather than just
assuming success. If any step could not be verified, it stops and tells
you exactly which one, instead of printing "Update complete" anyway.
Re-running the update is safe; contact DYO if the same step keeps failing.
