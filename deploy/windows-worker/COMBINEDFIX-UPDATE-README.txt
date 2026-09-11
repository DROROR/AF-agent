DYO WINDOWS WORKER - COMBINED FIX UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-CombinedFix-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original setup, or its saved registration was removed - use
the full DYO Worker setup package instead of this one in that case.

WHAT THIS UPDATES (all together, in one package)
-----------------------------------------------------
1. Complete Preview and final Render always render the full video, never
   a truncated work-area-only clip.
2. Complete Preview and Render always confirm the correct project is
   actually open in After Effects before doing anything with it.
3. Complete Preview, Render, and scene editing all correctly find a
   scene even if its position in the After Effects project shifted
   after building the Landscape/Reels version.
4. A new read-only diagnostic that reports a scene's own motion
   (position/scale/rotation), camera movement, and which visual effects
   are actually applied to it - used only for investigation, never
   changes anything by itself.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- The original, immutable source project file - never opened or changed.
- No After Effects project is opened, changed, or run against by this
  UPDATE ITSELF - it only updates program files and restarts DYO Worker,
  which then reports its normal status on its own. Each fix only takes
  effect the next time the dashboard dispatches the relevant action.
- Any asset-mapping or scene-approval decision - completely unaffected.
