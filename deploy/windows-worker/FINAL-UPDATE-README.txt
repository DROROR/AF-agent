DYO WINDOWS WORKER - FINAL UPDATE (COMPLETE AE EXECUTION + RENDER DELIVERY)
============================================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-Final-Update.bat
3. Done - it stops DYO Worker safely, updates the program files, restarts
   it, and proves the restart actually worked (including that it is
   running the exact expected final build) before saying so. No terminal
   knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original DYO-Worker-Setup.bat, or its saved registration was
removed - use the full DYO Worker setup package instead of this one in
that case.

WHAT THIS UPDATES
-------------------
This is the complete, consolidated DYO Worker release - it supersedes the
earlier CHECK_HEALTH and template-inspection update packages (this one
ships everything they shipped, plus everything below, all from one known
build). It adds:

- INSPECT_RENDER_CAPABILITIES - a new, read-only diagnostic DYO can
  dispatch later to list the real AE Render Queue template names and AE
  version on this machine. It only ever adds a temporary render-queue
  entry to read its own settings, then removes that same entry - it never
  saves the project and never touches your actual composition.
- EXECUTE_SCENE_EDIT - the scene-editing capability (text/footage swaps
  DYO's dashboard approves) using only a fixed, pre-approved set of
  operations - never an arbitrary script. If a job is interrupted partway
  (e.g. this computer restarts), it resumes from its last completed step
  instead of starting over, and it can capture a preview image of the
  first edited frame for DYO's own approval step.
- RENDER_PROJECT - the real rendering capability, using the same
  `aerender` command-line tool Adobe ships with After Effects, for
  whichever Landscape/Reels master composition and AE render templates
  DYO has explicitly configured for a project. It never renders anything
  DYO has not explicitly configured and approved.
- Uploading the finished rendered video file back to DYO once a render
  completes successfully, so it appears in DYO's own dashboard.
- Self-healing reliability: DYO Worker now survives an unreachable
  internet connection, a temporary DYO outage, or After Effects/ae-mcp
  being closed - it stays running and reconnects automatically, with no
  need to reboot this computer or re-run this update. If DYO Worker's own
  process ever crashes for any reason, Windows now restarts it
  automatically within about a minute. This update refreshes that
  automatic-recovery setting on your existing scheduled task even if it
  was originally set up a while ago, before this setting existed.

This update installs the CODE for all of the above. None of it runs on
its own - every one of these only ever runs when DYO explicitly dispatches
that exact, already-approved job to this computer, the same way template
inspection already works today.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
  (The Scheduled Task's automatic-recovery settings ARE refreshed by this
  update - see above - but it stays the exact same task, running as the
  exact same Windows user, pointed at the exact same program folder.)
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- No After Effects project is opened, changed, rendered, or run against by
  this update, or by anything it installs.

ABOUT RENDERING (AERENDER_PATH / AE_MCP_PATH)
------------------------------------------------
RENDER_PROJECT needs your .env to already have AERENDER_PATH pointing at
the real `aerender.exe` this After Effects install ships with, and several
capabilities (INSPECT_RENDER_CAPABILITIES, EXECUTE_SCENE_EDIT, and
RENDER_PROJECT's own composition check) need AE_MCP_PATH pointing at your
ae-mcp install, same as template inspection already requires. If either is
missing, DYO Worker still starts and reports its normal status - those
specific capabilities simply report as "not available" until the path is
added. This update does not add, guess, or change either value - if you
were not already given one of these paths to set, DYO will tell you
separately before asking for a real render.

IF IT SAYS "NEEDS ATTENTION"
------------------------------
This update actively verifies each step - including that DYO Worker
genuinely stopped before files were changed, that every new program file
this release adds genuinely exists on disk both before and after the
copy, that a real new process is running afterward with either a real
successful heartbeat or a genuine, actively-retrying connection attempt
(a temporary network delay during the update itself is not treated as a
failure), and that its build marker is the EXACT expected final build -
rather than just assuming success. If any step could not be verified, it
stops and tells you exactly which one, instead of printing "Update
complete" anyway. Re-running the update is safe; contact DYO if the same
step keeps failing.
