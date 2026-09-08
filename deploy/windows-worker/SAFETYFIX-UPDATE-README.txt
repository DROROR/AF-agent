DYO WINDOWS WORKER - CRITICAL SAFETY FIX UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-SafetyFix-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS UPDATES
-------------------
Fixes a critical safety issue in EXECUTE_FRAME (the operation that edits
and saves an After Effects project). Before this fix, EXECUTE_FRAME
mutated and saved whatever project After Effects already had open,
instead of explicitly opening the correct session working copy first.
This update makes EXECUTE_FRAME:
  - Explicitly open the correct session working copy in After Effects
    before making any edit, and refuse to proceed if After Effects
    reports any other project is open.
  - Independently verify the immutable source .aep's bytes are unchanged
    on disk, both before and after every execution, and stop immediately
    if they ever differ.
  - Refuse to report success if edits were supposedly applied but the
    working copy's own bytes never actually changed.

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

IMPORTANT - AFTER INSTALLING
-------------------------------
Do not run another real EXECUTE_FRAME job until DYO has confirmed:
  1. The server (API) side has been redeployed with the matching schema
     change (if required).
  2. Exactly one DYO Worker process is running for this machine.
  3. The restored source .aep's SHA256 has been re-verified.
