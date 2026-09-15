DYO WINDOWS WORKER - COMPLETE THE PENDING UPDATE
================================================

USE THIS ONLY IF DYO ASKS YOU TO
--------------------------------
For example when a DYO Worker update stopped with

  node.exe : npm notice
  CategoryInfo: NotSpecified   FullyQualifiedErrorId: NativeCommandError

or when the dashboard shows the worker OFFLINE although DYO Worker
processes are still running on this computer.

WHAT TO DO
----------
1. Double-click DYO-Worker-Complete-Pending-Update.bat
2. Wait until it prints "Done" or "[NEEDS ATTENTION]" (about 2-5 minutes).
3. Send DYO the result.

WHAT IT DOES
------------
- Copies NO program files. Proves the installed files are exactly the
  verified release (SHA-256) before touching any process.
- If a DYO Worker is already running, watches it for 60 seconds. If it is
  heartbeating, nothing is stopped.
- If it is NOT heartbeating (stale), it is stopped only when its log shows no
  unfinished job and neither After Effects nor aerender runs inside it. Its
  logs are saved first under C:\DYO-Agent\app\logs\stale-worker-evidence-*.
- Checks runtime dependencies without the PowerShell error that stopped the
  update.
- Starts DYO Worker through its existing startup task, confirms exactly one
  supervisor and one worker process, waits for fresh ONLINE / AE ONLINE /
  MCP ONLINE heartbeats, and prints the running build.

It never asks for a registration code, never changes this computer's DYO Worker
identity or .env, never stops After Effects, and never opens, changes or
renders any After Effects project.
