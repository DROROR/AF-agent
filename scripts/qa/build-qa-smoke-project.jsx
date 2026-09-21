/**
 * Builds the DISPOSABLE QA project for the build-8f3568a smoke test.
 * See docs/AE-SMOKE-TEST-8f3568a.md and the README beside this file.
 *
 * Run it from After Effects: File > Scripts > Run Script File...
 *
 * WHAT IT WILL AND WILL NOT DO
 *   - It refuses to run unless After Effects is in a clean, blank, untitled
 *     state: no saved project open, no unsaved changes, nothing in the
 *     project panel. If anything is open it STOPS and changes nothing - it
 *     never closes, saves or discards someone else's project, and it never
 *     answers a "Save changes?" prompt.
 *   - It creates exactly one file: C:\DYO-Agent\qa\smoke-75bcd90\QA-Smoke.aep.
 *     It refuses if that file already exists.
 *   - It imports ONLY the footage shipped beside this script, by relative
 *     position, so the project and its footage live in the same folder - which
 *     is what the disposable-copy inspection has to preserve.
 *   - It never reads, opens or references the client template, any session
 *     working copy, or anything outside its own folder. Every path below is a
 *     fixed constant; this script takes no input.
 *   - When it finishes it saves its own project and closes it, leaving After
 *     Effects blank again, because the worker must find the project closed.
 */
(function () {
  // The one folder this script is allowed to touch. Not a parameter.
  var QA_ROOT = "C:\\DYO-Agent\\qa\\smoke-75bcd90";
  var PROJECT_PATH = QA_ROOT + "\\QA-Smoke.aep";
  var FOOTAGE_NAMES = ["hardware-pass.png", "screenshot.png", "logo.png"];
  // The MOVING hardware pass: a numbered PNG sequence. After Effects imports
  // it as one footage item with hasVideo true and isStill FALSE, which is what
  // makes it a rendered pass rather than an authored shape - the whole point
  // of the QA_Screen slot below.
  var SEQUENCE_FOLDER = "footage\\hardware-pass-sequence";
  var SEQUENCE_FIRST_FRAME = "hardware-pass_0000.png";

  function stop(message) {
    alert("QA smoke project NOT created.\n\n" + message);
    throw new Error(message);
  }

  function normalise(path) {
    return String(path).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  }

  /* ---------------------------------------------------------------- *
   * 1. After Effects must be blank, untitled and clean.
   * ---------------------------------------------------------------- */

  if (!app.project) {
    stop("After Effects reports no project object at all. Restart After Effects and try again.");
  }
  if (app.project.file !== null) {
    stop(
      "A saved project is open in After Effects:\n\n  " +
        app.project.file.fsName +
        "\n\nThis script will not touch it. Close it yourself (File > Close Project), then run this script again."
    );
  }
  if (app.project.dirty) {
    stop(
      "After Effects is holding unsaved changes.\n\nThis script will not save or discard them. Deal with them yourself, " +
        "then run this script again with a blank, untitled project."
    );
  }
  if (app.project.numItems !== 0) {
    stop(
      "After Effects has an untitled project with " +
        app.project.numItems +
        " item(s) in it.\n\nThis script only runs against a completely blank project. Close it (File > Close Project) and try again."
    );
  }

  /* ---------------------------------------------------------------- *
   * 2. This script must be running from the QA folder, with its own
   *    footage beside it - that is what makes the footage RELATIVE.
   * ---------------------------------------------------------------- */

  var scriptFile = new File($.fileName);
  var scriptFolder = scriptFile.parent;
  if (normalise(scriptFolder.fsName) !== normalise(QA_ROOT)) {
    stop(
      "This script is running from:\n  " +
        scriptFolder.fsName +
        "\n\nIt must run from:\n  " +
        QA_ROOT +
        "\n\nExtract the QA fixture ZIP into that exact folder (so that QA-Smoke footage sits beside this script) and run it from there."
    );
  }

  var existing = new File(PROJECT_PATH);
  if (existing.exists) {
    stop(
      "QA-Smoke.aep already exists:\n  " +
        existing.fsName +
        "\n\nThis script never overwrites it. Delete the whole smoke-75bcd90 folder, extract the fixture again, and re-run - so the test never reuses an earlier run's state."
    );
  }

  var footageFiles = [];
  for (var i = 0; i < FOOTAGE_NAMES.length; i++) {
    var f = new File(QA_ROOT + "\\footage\\" + FOOTAGE_NAMES[i]);
    if (!f.exists) {
      stop("Missing footage file:\n  " + f.fsName + "\n\nExtract the whole QA fixture ZIP, keeping its footage folder.");
    }
    footageFiles.push(f);
  }

  var sequenceFirst = new File(QA_ROOT + "\\" + SEQUENCE_FOLDER + "\\" + SEQUENCE_FIRST_FRAME);
  if (!sequenceFirst.exists) {
    stop("Missing the moving hardware pass:\n  " + sequenceFirst.fsName + "\n\nExtract the whole QA fixture ZIP, keeping its footage folder and the hardware-pass-sequence folder inside it.");
  }

  /* ---------------------------------------------------------------- *
   * 3. Build the project. Everything from here is in ITS OWN project -
   *    created by this script, never anybody else's.
   * ---------------------------------------------------------------- */

  var createdOurOwnProject = false;
  var saved = false;
  try {
    app.newProject();
    createdOurOwnProject = true;
    app.beginUndoGroup("Build QA smoke project");

    var imported = [];
    for (var j = 0; j < footageFiles.length; j++) {
      imported.push(app.project.importFile(new ImportOptions(footageFiles[j])));
    }
    var stillHardware = imported[0];
    var screenshot = imported[1];

    // Imported as a SEQUENCE - one moving footage item, not twelve stills.
    var sequenceOptions = new ImportOptions(sequenceFirst);
    sequenceOptions.sequence = true;
    var movingHardware = app.project.importFile(sequenceOptions);
    imported.push(movingHardware);
    if (movingHardware.mainSource.isStill) {
      stop(
        "After Effects imported the hardware pass as a STILL, not as a sequence.\n\n" +
          "The smoke test cannot tell moving footage from a still matte without it. Delete the QA folder, extract the fixture again, and make sure the whole hardware-pass-sequence folder came with it."
      );
    }

    // Every import must have resolved - a missing one here would make the
    // whole smoke test meaningless.
    for (var k = 0; k < imported.length; k++) {
      if (imported[k].footageMissing) {
        stop("After Effects could not resolve the footage file:\n  " + FOOTAGE_NAMES[k]);
      }
    }

    // --- The two slot compositions a client asset can land in. -----------
    // Their CONTENT is a plain solid: the classifier must decide what they
    // are from how they are PLACED, never from what is inside them or from
    // their names.
    var screenSlot = app.project.items.addComp("QA_Screen", 1080, 2160, 1, 10, 25);
    screenSlot.layers.addSolid([0.1, 0.1, 0.1], "slot", 1080, 2160, 1);

    var cardSlot = app.project.items.addComp("QA_Card", 1600, 900, 1, 10, 25);
    cardSlot.layers.addSolid([0.1, 0.1, 0.1], "slot", 1600, 900, 1);

    // --- The scene --------------------------------------------------------
    var scene = app.project.items.addComp("QA_Scene", 1920, 1080, 1, 10, 25);

    // A DEVICE SCREEN: the slot is cut by a matte made from imported footage
    // (the hardware pass), sits in 3D, and hangs off an animated parent.
    var helper = scene.layers.addNull();
    helper.name = "QA_Helper";
    helper.threeDLayer = true;
    var helperPosition = helper.property("ADBE Transform Group").property("ADBE Position");
    helperPosition.setValueAtTime(0, [860, 540, 0]);
    helperPosition.setValueAtTime(5, [1060, 540, 0]);

    var hardwareMatte = scene.layers.add(movingHardware);
    hardwareMatte.name = "QA_HardwarePass";
    hardwareMatte.property("ADBE Transform Group").property("ADBE Scale").setValue([40, 40]);

    var screenLayer = scene.layers.add(screenSlot);
    screenLayer.name = "QA_ScreenHost";
    screenLayer.threeDLayer = true;
    screenLayer.property("ADBE Transform Group").property("ADBE Scale").setValue([40, 40, 100]);
    screenLayer.parent = helper;
    screenLayer.trackMatteType = TrackMatteType.LUMA;
    screenLayer.inPoint = 1;
    screenLayer.outPoint = 7;

    // A FLAT CARD: cut by a matte a designer DREW (a solid), 2D, unparented.
    scene.layers.addSolid([1, 1, 1], "QA_DrawnMatte", 1600, 900, 1);
    var cardLayer = scene.layers.add(cardSlot);
    cardLayer.name = "QA_CardHost";
    cardLayer.property("ADBE Transform Group").property("ADBE Scale").setValue([50, 50]);
    cardLayer.property("ADBE Transform Group").property("ADBE Position").setValue([500, 800]);
    cardLayer.trackMatteType = TrackMatteType.ALPHA;
    cardLayer.inPoint = 2;
    cardLayer.outPoint = 8;

    // THE CONTROL CASE for the 2026-09-21 matte-source correction: the same
    // 3D, animated-parent shape as QA_ScreenHost, but cut by a STILL image
    // instead of the sequence. It must NOT come out as a confident device
    // screen - a still matte is an authored shape, and the two sources must
    // never produce the same matte-source fact.
    var stillMatte = scene.layers.add(stillHardware);
    stillMatte.name = "QA_StillPass";
    stillMatte.property("ADBE Transform Group").property("ADBE Scale").setValue([25, 25]);
    stillMatte.property("ADBE Transform Group").property("ADBE Position").setValue([300, 300]);

    var stillMattedSlot = scene.layers.add(screenSlot);
    stillMattedSlot.name = "QA_StillMattedHost";
    stillMattedSlot.threeDLayer = true;
    stillMattedSlot.property("ADBE Transform Group").property("ADBE Scale").setValue([25, 25, 100]);
    stillMattedSlot.property("ADBE Transform Group").property("ADBE Position").setValue([300, 300, 0]);
    stillMattedSlot.parent = helper;
    stillMattedSlot.trackMatteType = TrackMatteType.LUMA;
    stillMattedSlot.inPoint = 1;
    stillMattedSlot.outPoint = 7;

    // NEVER ON SCREEN - positioned entirely outside the frame.
    var offscreen = scene.layers.add(cardSlot);
    offscreen.name = "QA_Offscreen";
    offscreen.property("ADBE Transform Group").property("ADBE Position").setValue([-4000, 540]);
    offscreen.property("ADBE Transform Group").property("ADBE Scale").setValue([50, 50]);
    offscreen.inPoint = 0;
    offscreen.outPoint = 9;

    // NEVER ON SCREEN - held at zero opacity for its whole span.
    var faded = scene.layers.add(cardSlot);
    faded.name = "QA_FadedOut";
    faded.property("ADBE Transform Group").property("ADBE Scale").setValue([50, 50]);
    faded.property("ADBE Transform Group").property("ADBE Position").setValue([1400, 300]);
    faded.inPoint = 0;
    faded.outPoint = 9;
    var opacity = faded.property("ADBE Transform Group").property("ADBE Opacity");
    opacity.setValueAtTime(0, 0);
    opacity.setValueAtTime(9, 0);

    // Hebrew template wording, for the RTL and leftover-template-copy gates.
    var text = scene.layers.addText("\u05D8\u05E7\u05E1\u05D8 \u05EA\u05D1\u05E0\u05D9\u05EA");
    text.name = "QA_Hebrew";
    text.property("ADBE Transform Group").property("ADBE Position").setValue([960, 980]);
    text.inPoint = 1;
    text.outPoint = 8;

    // A screenshot placed directly in the scene, so a TOP-LEVEL slot (a layer
    // rather than a whole composition) is covered too.
    var direct = scene.layers.add(screenshot);
    direct.name = "QA_DirectImage";
    direct.property("ADBE Transform Group").property("ADBE Scale").setValue([15, 15]);
    direct.property("ADBE Transform Group").property("ADBE Position").setValue([1600, 800]);
    direct.inPoint = 3;
    direct.outPoint = 9;

    app.endUndoGroup();

    app.project.save(new File(PROJECT_PATH));

    // Prove the file genuinely landed before closing anything.
    var written = new File(PROJECT_PATH);
    if (!written.exists || written.length <= 0) {
      stop("After Effects reported a save, but no usable file is on disk at:\n  " + PROJECT_PATH);
    }
    saved = true;
  } catch (buildError) {
    // Close only what THIS script created. Reaching here means After Effects
    // was blank and untitled when we started, so the open project is ours.
    if (createdOurOwnProject && !saved) {
      try {
        app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
      } catch (closeError) {
        // Nothing further to do - the operator is told below.
      }
    }
    throw buildError;
  }

  // Close OUR OWN, ALREADY-SAVED project, so the worker finds it closed and
  // After Effects is blank again. Nothing unsaved can be lost here.
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);

  alert(
    "QA smoke project created:\n\n  " +
      PROJECT_PATH +
      "\n\nAfter Effects has been left blank and the project closed, which is what the smoke test needs.\n\n" +
      "Nothing else was opened, changed or saved."
  );
})();
