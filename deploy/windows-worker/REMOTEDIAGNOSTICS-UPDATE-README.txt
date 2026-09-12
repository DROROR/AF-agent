DYO WINDOWS WORKER - REMOTE DIAGNOSTICS UPDATE
==============================================

WHAT TO DO
----------
1. Unzip this folder anywhere (Downloads is fine).
2. Double-click DYO-Worker-RemoteDiagnostics-Update.bat
3. Wait until it prints a final result and says you can close the window.

You will NOT be asked for a registration code, a Windows password, or an
Adobe password. If it asks you for any of those, something is wrong - stop
and tell us.

Do not open After Effects while this runs. You do not need to restart
Windows afterwards.


WHAT THIS FIXES
---------------
1. The Worker could go permanently silent while still running.

   On 12 September the Worker's log ended with a normal, successful
   heartbeat - and then nothing, ever again, even though the process was
   still alive. The server stopped receiving anything from it and a queued
   job was never picked up. The cause was that the Worker only scheduled
   its next heartbeat AFTER the previous one finished, so a single network
   or health call that never finished ended the cycle for good, silently.

   The heartbeat now runs under a hard time limit and schedules its next
   attempt first, so a stuck call becomes a normal logged failure that
   retries by itself.

2. You no longer have to copy log output by hand.

   The dashboard can now ask this machine directly for: the Worker log, the
   previous Worker log, the DYO process list, free disk space, After
   Effects / ae-mcp health, the current job, and a job's files. It can also
   restart the Worker safely.


WHAT THIS DOES *NOT* DO - PLEASE READ
-------------------------------------
- It does NOT open a port, and it does NOT let anyone connect INTO this
  computer. The Worker still only ever dials out, exactly as before. No
  RDP, no AnyDesk, no router change, no public IP.
- It does NOT give anyone a command line or remote shell on this computer.
  The dashboard can only pick one option from a fixed list. There is no
  place to type a command, and no place to type a file path.
- It can only read inside C:\DYO-Agent. It cannot read your documents,
  your desktop, your browser data, or anything else on the machine.
- Passwords, tokens, .env contents and Adobe credentials are removed on
  THIS computer before anything is sent.
- The safe restart never creates a second Worker and never changes this
  Worker's identity. It also refuses to run while a render or a project
  edit is in progress.

Your Worker identity, your .env settings, your credentials and your job
history are all left exactly as they are. The original template .aep files
are never touched.


IF SOMETHING GOES WRONG
-----------------------
This update backs up the current program files first, checks that the
Worker actually came back up, and automatically puts the backup back if it
did not. If it reports a problem, send us what it printed.
