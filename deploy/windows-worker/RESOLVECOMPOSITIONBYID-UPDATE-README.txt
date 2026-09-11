DYO WINDOWS WORKER - RESOLVE COMPOSITION BY DURABLE ID FIX UPDATE
==============================================================

This is for a computer that has ALREADY set up DYO Worker once before
(you already ran DYO-Worker-Setup.bat and it said "Setup complete").

You will NOT be asked for a registration code. This does not create a
new DYO Worker connection - it updates the one you already have.

WHAT TO DO
-----------
1. Extract this ZIP (keep all the files together in one folder).
2. Double-click DYO-Worker-ResolveCompositionById-Update.bat
3. Done - it updates the program files and restarts DYO Worker
   automatically. No terminal knowledge needed, no password needed.

If it says "No saved worker registration was found", this computer never
completed the original setup, or its saved registration was removed - use
the full DYO Worker setup package instead of this one in that case.

WHAT THIS FIXES
-------------------
A read-only diagnostic failed with a confusing error: the scene it asked
about ("Scene 1") was reported as a completely different scene
("Pre-comp 5"). This happened because building the Landscape composition
earlier had inserted a new item into the After Effects project, which
shifted the recorded position of every scene that came after it - nothing
previously re-checked whether a scene's recorded position was still
correct after that kind of change.

This update fixes that: Complete Preview, final Render, and every
read-only composition-inspection tool now find the correct scene by its
own permanent After Effects identity first, instead of trusting a
recorded position that can silently go out of date. If a scene has
genuinely been removed, the job now fails with a clear, honest message
instead of quietly reporting on or rendering the wrong one.

WHAT THIS DOES NOT TOUCH
---------------------------
- Your existing DYO Worker registration/identity - kept exactly as-is.
- No new registration code is asked for or used.
- No Windows account password is asked for or stored.
- Your .env configuration file - not rewritten at all by this update.
- The original, immutable source project file - never opened or changed.
- No After Effects project is opened, changed, or run against by this
  UPDATE ITSELF - it only updates program files and restarts DYO Worker,
  which then reports its normal status on its own. The fixed check only
  runs the next time the dashboard dispatches Complete Preview, Render,
  or a composition inspection.
- Any scene-editing or asset-mapping operation - this update has nothing
  to do with either of them.
