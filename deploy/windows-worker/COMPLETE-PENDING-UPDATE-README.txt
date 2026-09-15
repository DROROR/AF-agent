DYO WINDOWS WORKER - COMPLETE THE PENDING UPDATE
================================================

USE THIS ONLY IF
----------------
The DYO Worker update stopped with a message like:

  node.exe : npm notice
  CategoryInfo: NotSpecified   FullyQualifiedErrorId: NativeCommandError

and never printed "Starting DYO Worker".

WHAT TO DO
----------
1. Double-click DYO-Worker-Complete-Pending-Update.bat
2. Wait until it prints "Done" or "[NEEDS ATTENTION]".
3. Send DYO the result.

WHAT IT DOES
------------
- Copies NO program files - the update already copied them.
- Proves the installed files are exactly the verified release (SHA-256).
- Refuses if a DYO Worker is already running, so it can never start a second one.
- Checks runtime dependencies without the PowerShell error that stopped the update.
- Starts DYO Worker through its existing startup task and confirms exactly one
  supervisor and exactly one worker process.

It never asks for a registration code, never changes this computer's DYO Worker
identity or .env, and never opens, changes or renders any After Effects project.
