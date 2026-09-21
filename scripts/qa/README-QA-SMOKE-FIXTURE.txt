QA smoke-test fixture for DYO worker build 8f3568a
==================================================

This fixture builds a THROWAWAY After Effects project used to smoke-test the
worker build 8f3568a104a6dfb5c14a0497710058249ea9256f.

It exists so the first real After Effects exercise of a new build happens
against something disposable. The client template, the session working copy and
session e0483ad6 are not used, opened or referenced anywhere in this fixture.


WHAT IS IN THIS ZIP
-------------------
  build-qa-smoke-project.jsx      the script that builds the QA project
  README-QA-SMOKE-FIXTURE.txt     this file
  footage\hardware-pass.png       1080x2160, fully opaque - a STILL matte
  footage\hardware-pass-sequence\ 12 numbered PNG frames, 1080x2160 - a MOVING
                                  matte (After Effects imports the folder as one
                                  image sequence: hasVideo true, isStill FALSE)
  footage\screenshot.png          1080x2160, fully opaque
  footage\logo.png                800x800, genuinely transparent (69.5% of its
                                  pixels are see-through; its visible content is
                                  a 500x500 block at x=150, y=150)

The footage is imported by RELATIVE position - it sits beside the project - so
the inspection's disposable-copy behaviour (the copy is made next to the file,
precisely so relative footage still resolves) is genuinely exercised.


STEP 1 - GET THE FIXTURE ONTO THE WORKER MACHINE
------------------------------------------------
Run in PowerShell on the worker machine. Extract it into EXACTLY this folder -
the script refuses to run from anywhere else, so the footage can never end up
somewhere other than beside the project:

  scp fahad@169.58.48.14:/home/fahad/windows-worker-releases/DYO-QA-Smoke-Fixture-75bcd90.zip "$env:USERPROFILE\Downloads\DYO-QA-Fixture.zip"
  $e="<SHA-256 from the release notes>"
  $a=(Get-FileHash "$env:USERPROFILE\Downloads\DYO-QA-Fixture.zip" -Algorithm SHA256).Hash.ToLower()
  if($a -ne $e){Write-Host "MISMATCH - STOP. $a"}else{
   New-Item -ItemType Directory -Force -Path "C:\DYO-Agent\qa\smoke-fixture-v3" | Out-Null
   Expand-Archive "$env:USERPROFILE\Downloads\DYO-QA-Fixture.zip" "C:\DYO-Agent\qa\smoke-fixture-v3" -Force
   Get-ChildItem -Recurse "C:\DYO-Agent\qa\smoke-fixture-v3" | Select-Object FullName, Length
  }

Expected afterwards:
  C:\DYO-Agent\qa\smoke-fixture-v3\build-qa-smoke-project.jsx
  C:\DYO-Agent\qa\smoke-fixture-v3\README-QA-SMOKE-FIXTURE.txt
  C:\DYO-Agent\qa\smoke-fixture-v3\footage\hardware-pass.png
  C:\DYO-Agent\qa\smoke-fixture-v3\footage\screenshot.png
  C:\DYO-Agent\qa\smoke-fixture-v3\footage\logo.png
  C:\DYO-Agent\qa\smoke-fixture-v3\footage\hardware-pass-sequence\hardware-pass_0000.png
  ... through hardware-pass_0011.png (12 frames)


STEP 2 - BUILD THE QA PROJECT IN AFTER EFFECTS
-----------------------------------------------
1. Open After Effects with NOTHING open: no project, no unsaved changes, and an
   empty project panel. If a project is open, close it yourself first
   (File > Close Project). The script will not close, save or discard anything.
2. File > Scripts > Run Script File...
3. Choose  C:\DYO-Agent\qa\smoke-fixture-v3\build-qa-smoke-project.jsx
4. It creates C:\DYO-Agent\qa\smoke-fixture-v3\QA-Smoke.aep, saves it, closes it,
   and leaves After Effects blank again. It tells you so in a dialog.

If it refuses, it says exactly why and changes nothing. The refusals are:
  - After Effects did not accept a track matte, or bound the wrong layer as
    one (verified immediately after each binding - see below);
  - a saved project is open;
  - there are unsaved changes;
  - the untitled project is not empty;
  - the script is not running from C:\DYO-Agent\qa\smoke-fixture-v3;
  - QA-Smoke.aep already exists there;
  - a footage file or the hardware-pass-sequence folder is missing;
  - After Effects imported the sequence as a still (the matte-source check
    below would then be meaningless, so it stops rather than build it).

Do not re-run it over an existing QA-Smoke.aep. To start again, delete the whole
C:\DYO-Agent\qa\smoke-fixture-v3 folder and extract the ZIP again.


STEP 3 - RECORD THE FIXTURE HASH, THEN RUN THE SMOKE TEST
----------------------------------------------------------
Before any job touches it:

  Get-FileHash "C:\DYO-Agent\qa\smoke-fixture-v3\QA-Smoke.aep" -Algorithm SHA256

Keep that value. The whole point of the first smoke-test step is that the hash
is IDENTICAL afterwards - inspections work on a disposable copy, never on the
file itself.

Then follow docs/AE-SMOKE-TEST-8f3568a.md from step 2 onwards.

Leave After Effects with nothing open while the smoke test runs. The worker
refuses to inspect anything while After Effects holds a dirty or untitled
project, and it will never answer a "Save changes?" prompt for you.


WHAT THE QA PROJECT CONTAINS, AND WHY
--------------------------------------
  QA_Scene          the scene composition (1920x1080, 10s, 25fps)
  QA_ScreenHost     places QA_Screen with a LUMA matte taken from the MOVING
                    hardware pass (the image sequence), in 3D, parented to an
                    animated null
                    -> matte source must be RENDERED_FOOTAGE
                    -> must be classified device_screen, confidently
  QA_StillMattedHost the SAME 3D animated shape, cut by the STILL hardware image
                    instead of the sequence
                    -> matte source must be DRAWN_MASK_OR_SOLID
                    -> must NOT be a confident device screen: it is reported as
                       conflicting and handed to a human
  QA_CardHost       places QA_Card with an ALPHA matte taken from a solid the
                    script draws, in 2D, unparented
                    -> must be classified flat_card
  QA_Offscreen      the same card parked far outside the frame
                    -> must yield NO evidence frame
  QA_FadedOut       the same card held at 0% opacity for its whole span
                    -> must yield NO evidence frame
  QA_Hebrew         a text layer reading the template wording
                    -> exercises RTL application and the leftover-copy gate
  QA_DirectImage    a screenshot placed straight into the scene
                    -> a top-level slot (a layer, not a whole composition)

Every layer has staggered in/out points, so the moment chosen for an evidence
frame has to fall inside a genuinely visible window rather than at t=0.


HOW THE MATTES ARE BOUND, AND WHY IT IS CHECKED
------------------------------------------------
On After Effects 2023 and newer, setting a layer's track-matte TYPE does not
bind a matte LAYER - the project ends up with matte modes and no mattes. The
first version of this fixture did exactly that: After Effects reported
hasTrackMatte=false on every host, and the inspection that followed could not
tell a screen from a card, because there were no mattes to read.

This version binds each matte with setTrackMatte(matteLayer, type) (falling
back to the pre-2023 way, with the matte placed directly above its host), and
then asks After Effects to confirm it: hasTrackMatte must be true, and the
bound matte layer must be the exact layer intended. If either check fails, the
script STOPS and saves nothing.


THE MATTE-SOURCE CHECK THIS FIXTURE EXISTS TO MAKE
---------------------------------------------------
QA_ScreenHost and QA_StillMattedHost are deliberately identical in every way
except what their matte is made of: one is cut by the moving image sequence,
the other by the still image.

  - QA_ScreenHost      matte source RENDERED_FOOTAGE, confident device_screen
  - QA_StillMattedHost matte source DRAWN_MASK_OR_SOLID, conflicting, needs a
                       human decision

If those two slots report the SAME matte source, the smoke test has FAILED -
stop and report it. That equality was a real defect (After Effects reports
hasVideo for a still image as well as a movie, so a still matte was being read
as a rendered hardware pass); it is corrected in this build, and this pair is
what proves it stays corrected on a real machine.
