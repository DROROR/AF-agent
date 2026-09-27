# Setting up a client's Windows machine

What has to be true before the DYO worker can run on someone else's computer, in the order it has to become true. Written for whoever does the install, not for an engineer.

## What this machine is for

It is the only machine that touches After Effects. The dashboard and the database live on the server; this computer does the actual editing and rendering. It connects OUTWARD to the server over HTTPS - no ports are opened on it, no remote access is needed, and it never receives an inbound connection.

## Prerequisites, in order

**1. After Effects 2026**, installed and opened at least once so its first-run dialogs are out of the way.

**2. Scripting access turned on.** After Effects → Edit → Preferences → Scripting & Expressions → "Allow Scripts to Write Files and Access Network". Without this the bridge cannot drive After Effects at all.

**3. Node.js.** The installer checks for it and tells you if it is missing.

**4. `ae-mcp`, at `C:\AI-Tools\ae-mcp`.** ⚠️ **This is NOT part of the DYO package and has to be put there separately.** The installer checks for `C:\AI-Tools\ae-mcp\dist\index.js` and refuses with "ae-mcp was not found (or is incomplete)" if it is absent. On the current worker machine it was installed by hand, so this step has never been exercised on a fresh computer — treat it as the most likely place a new install stops.

**5. A registration code.** This is the server's `WORKER_REGISTRATION_SECRET`. Read it off the server (`pm2 env 2 | grep WORKER_REGISTRATION_SECRET`) at the moment you need it. Do not paste it into chat, email or a ticket, and do not commit it anywhere.

## Installing

1. Copy `DYO-Client-Setup.zip` onto the machine and extract it anywhere.
2. Double-click `DYO-Worker-Setup.bat`. No terminal knowledge is needed - every step prints a plain status line.
3. Enter the registration code when asked. It is typed masked and is never written to disk.
4. The installer registers this computer, installs the worker, and creates a Windows Scheduled Task ("DYO Video Worker") so it starts by itself at logon from then on.

`DYO-Worker-Start.bat`, `DYO-Worker-Stop.bat` and `DYO-Worker-Uninstall.bat` sit beside it for the rare times they are needed.

## Checking it actually worked

On the dashboard, Workers should show this computer **ONLINE**, with After Effects and the bridge both ONLINE and a heartbeat within the last minute. All three matter: the worker can be online while the bridge is not, and the dashboard says so.

If the bridge shows OFFLINE, or a job fails with `AE_NOT_CONNECTED`, fully quit and reopen After Effects once so its startup script loads. This is the single most common thing that goes wrong, and it happened repeatedly during development.

## What this machine must keep

- **After Effects left open and idle**, with no project loaded and no dialog on screen. A modal dialog blocks the bridge completely, and the worker will not answer a "Save changes?" prompt for anybody.
- **Enough disk space** for working copies and renders. Each execution session copies the project.

## Fonts

A template's fonts have to exist on THIS machine. If they do not, After Effects substitutes something else and the render looks wrong without failing. Template inspection reports the fonts a template needs (`requiredFonts`) - check them against the machine before promising a result.

## What is deliberately not installed

No inbound remote access, no port forwarding, no public IP, and none of the client's own credentials on the server. The connection is outbound only, by design.
