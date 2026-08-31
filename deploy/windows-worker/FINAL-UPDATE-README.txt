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
- CREATE_PREVIEW - creates a real, complete-length preview video of the
  project as currently approved, using the exact same `aerender` process
  as a final render. This is only a review copy for DYO to check before
  the final video - it never counts as, or replaces, the final rendered
  output, and it never runs on its own without DYO explicitly requesting
  it.
- Self-healing reliability: DYO Worker now survives an unreachable
  internet connection, a temporary DYO outage, or After Effects/ae-mcp
  being closed - it stays running and reconnects automatically, with no
  need to reboot this computer or re-run this update. If DYO Worker's own
  process ever crashes for any reason, Windows now restarts it
  automatically within about a minute. This update refreshes that
  automatic-recovery setting on your existing scheduled task even if it
  was originally set up a while ago, before this setting existed - and
  now safely recovers even if that existing task definition was itself
  damaged or very old, rather than stopping the update partway through.
  If the "DYO Video Worker" automatic-startup task is missing entirely
  (for example, removed by antivirus/cleanup software), this update now
  recreates it automatically too - using your existing registration and
  configuration, never asking for a registration code and never touching
  your saved worker identity. You do not need to run a separate repair
  package for this anymore.
- REAL FIX for a confirmed production issue: DYO Worker used to run
  directly under a visible console window. If that window was ever
  closed, or Windows ended the session it was running in, the worker
  could be killed with no restart at all - Windows' own recovery setting
  above does not reliably cover that specific case, only an ordinary
  crash. This update changes the automatic-startup task to run DYO Worker
  through a small, hidden supervisor instead: there is no window to close
  anymore, and the supervisor restarts the worker itself after any
  ordinary/unexpected stop, independent of Windows' own recovery setting.
  Same worker identity and configuration either way - this only changes
  HOW reliably it recovers, never WHO or WHAT it is. A real Windows
  log-off still makes After Effects/the worker unavailable (as it always
  has - AE needs your desktop session) - the next time you log back in,
  the supervisor and worker start automatically, same as before, with no
  action needed from you.

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

A missing automatic-startup task no longer stops the update - it is
recreated automatically (see above). You will only be told to run
DYO-Worker-Repair.bat if that automatic recreation itself could not be
confirmed after two attempts, which this update will say explicitly.

OPTIONAL: PROVING SELF-HEALING WORKS ON YOUR MACHINE
--------------------------------------------------------
This package also includes DYO-Worker-Lifecycle-SelfTest.bat - an optional,
real check you can run any time (only when no DYO job is currently in
progress - it checks this itself and refuses to run destructively if one
might be). It terminates only the current worker process (never After
Effects, ae-mcp, or the Scheduled Task) and proves the hidden supervisor
restarts it on its own, with a fresh heartbeat and the exact same worker
identity - no reboot, no Repair.bat, no re-running this updater. Safe to
skip; DYO Worker is already running normally either way.
