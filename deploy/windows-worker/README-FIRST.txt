DYO WINDOWS WORKER - SETUP INSTRUCTIONS
========================================

You do not need to know anything technical to do this. You will not need
to open a terminal or type any commands.

FIRST TIME:
-----------
1. Extract the ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-Setup.bat
3. Enter the one-time setup code you were given, when asked.
4. Done.

AFTERWARD:
----------
DYO Worker starts automatically every time you log into Windows. You do
not need to open, run, or double-click anything again for normal use.

WHAT YOU NEED BEFORE YOU START
-------------------------------
- This whole folder, kept together in one place (don't move files out of it).
- The one-time registration code DYO gave you. Keep it private - you will
  be asked for it once, during setup, and never again after that.

WHAT HAPPENS DURING SETUP
---------------------------
A black window opens and checks a few things on your computer. If
everything looks good, it installs the DYO Worker, asks for your
registration code once (it won't appear on screen as you type it - that's
expected, it's protecting it), registers this computer with DYO, and sets
up automatic startup. When it says "Setup complete", you're done - it also
shows you the worker's current status right away.

If it says "Setup cannot continue yet" and lists something to fix (for
example, "Node.js was not found"), fix that one thing and double-click
DYO-Worker-Setup.bat again. It's safe to run more than once.

CHECKING ON IT LATER
----------------------
DYO Worker runs quietly in the background - you won't normally see a
window for it. If you want to check on it or watch it live:
- Double-click DYO-Worker-Start.bat to run it in a visible window (it will
  warn you first if it's already running automatically in the background).
- Or look in the DYO-Agent\app\logs folder on your C: drive for its latest
  status.

STOPPING OR REMOVING IT
--------------------------
- To stop it for now (it will start again next time you log in):
  double-click DYO-Worker-Stop.bat
- To remove automatic startup entirely: double-click
  DYO-Worker-Uninstall.bat. This only removes the DYO Worker's own startup
  entry - nothing else on your computer is touched. It will ask you
  separately whether to also delete your saved registration.

SOMETHING NOT WORKING?
------------------------
- "After Effects: Offline" or "ae-mcp: Unknown" - this is honest, not
  broken: it means the worker can't yet confirm that status. If After
  Effects isn't open, or ae-mcp's status file doesn't exist yet, this is
  expected. It updates automatically once that changes - you don't need to
  restart anything.
- "[WARN] Lost connection to DYO - retrying automatically" - this is
  normal for a brief internet hiccup and usually clears itself within a
  few seconds. If it keeps happening for several minutes, check your
  internet connection.
- Anything else - take a screenshot of the DYO-Worker-Start.bat window (or
  the DYO-Agent\app\logs folder) and send it to DYO. The registration code and
  worker credentials are never shown on screen or written to any log, so
  it's safe to share a screenshot.

WHAT THIS DOES NOT DO (BY DESIGN)
------------------------------------
- It never asks for your Windows account password, during setup or for
  automatic startup.
- It never changes anything inside After Effects on its own - it only
  reports status until DYO explicitly asks it to do an approved job in a
  later step.
- It never sends your registration code anywhere after the one-time setup
  step - it's deleted from this computer automatically once setup succeeds.
- The worker keeps running and stays connected to DYO even while After
  Effects is closed - it will just honestly show "Offline" for After
  Effects and ae-mcp until you open them.

FFMPEG NOTE
------------
FFmpeg is not required for this setup or for connecting to DYO. It will
only be needed later, for video preview/processing steps - you'll be told
separately if and when to install it.
