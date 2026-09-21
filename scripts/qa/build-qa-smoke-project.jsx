/**
 * Builds the DISPOSABLE QA project for the build-8f3568a smoke test.
 * See docs/AE-SMOKE-TEST-8f3568a.md.
 *
 * Run it from After Effects: File > Scripts > Run Script File...
 *
 * IT ONLY EVER CREATES A NEW PROJECT. It never opens, reads or modifies an
 * existing one: it refuses to run while a project with unsaved changes is
 * open, and it writes only to the folder it is told about below.
 *
 * Expected folder, prepared by hand BEFORE running this:
 *   C:\DYO-Agent\qa\smoke-8f3568a\footage\hardware-pass.png   (opaque, 1080x2160)
 *   C:\DYO-Agent\qa\smoke-8f3568a\footage\screenshot.png      (opaque, 1080x2160)
 *   C:\DYO-Agent\qa\smoke-8f3568a\footage\logo.png            (transparent background)
 *
 * The footage is imported by RELATIVE position (it lives beside the project),
 * which is exactly what the disposable-copy inspection has to preserve.
 */
(function () {
  var ROOT = "C:\\DYO-Agent\\qa\\smoke-8f3568a";
  var PROJECT_PATH = ROOT + "\\QA-Smoke.aep";

  function fail(message) {
    alert("QA smoke project NOT created:\n\n" + message);
    throw new Error(message);
  }

  if (app.project && app.project.dirty) {
    fail("After Effects is holding a project with unsaved changes. Save or close it first - this script will not touch it.");
  }

  var rootFolder = new Folder(ROOT);
  if (!rootFolder.exists) {
    fail("Folder does not exist: " + ROOT);
  }
  var existing = new File(PROJECT_PATH);
  if (existing.exists) {
    fail("QA-Smoke.aep already exists. Delete the whole smoke-8f3568a folder and start clean, so the test never reuses an earlier run's state.");
  }

  var footageNames = ["hardware-pass.png", "screenshot.png", "logo.png"];
  var footageFiles = [];
  for (var i = 0; i < footageNames.length; i++) {
    var f = new File(ROOT + "\\footage\\" + footageNames[i]);
    if (!f.exists) {
      fail("Missing footage file: " + f.fsName);
    }
    footageFiles.push(f);
  }

  app.newProject();
  app.beginUndoGroup("Build QA smoke project");
  try {
    var imported = [];
    for (var j = 0; j < footageFiles.length; j++) {
      imported.push(app.project.importFile(new ImportOptions(footageFiles[j])));
    }
    var hardware = imported[0];
    var screenshot = imported[1];

    // --- The two slot compositions a client asset can land in. ---------------
    // Their CONTENT is a plain solid: the classifier must decide what they are
    // from how they are PLACED, never from what is inside them or their names.
    var screenSlot = app.project.items.addComp("QA_Screen", 1080, 2160, 1, 10, 25);
    screenSlot.layers.addSolid([0.1, 0.1, 0.1], "slot", 1080, 2160, 1);

    var cardSlot = app.project.items.addComp("QA_Card", 1600, 900, 1, 10, 25);
    cardSlot.layers.addSolid([0.1, 0.1, 0.1], "slot", 1600, 900, 1);

    // --- The scene ----------------------------------------------------------
    var scene = app.project.items.addComp("QA_Scene", 1920, 1080, 1, 10, 25);

    // A DEVICE SCREEN: the slot is cut by a matte made from RENDERED FOOTAGE
    // (the hardware pass), sits in 3D, and hangs off an animated parent.
    var helper = scene.layers.addNull();
    helper.name = "QA_Helper";
    helper.threeDLayer = true;
    var helperPosition = helper.property("ADBE Transform Group").property("ADBE Position");
    helperPosition.setValueAtTime(0, [860, 540, 0]);
    helperPosition.setValueAtTime(5, [1060, 540, 0]);

    var hardwareMatte = scene.layers.add(hardware);
    hardwareMatte.name = "QA_HardwarePass";
    hardwareMatte.scale.setValue([40, 40]);

    var screenLayer = scene.layers.add(screenSlot);
    screenLayer.name = "QA_ScreenHost";
    screenLayer.threeDLayer = true;
    screenLayer.scale.setValue([40, 40]);
    screenLayer.parent = helper;
    screenLayer.trackMatteType = TrackMatteType.ALPHA;
    screenLayer.inPoint = 1;
    screenLayer.outPoint = 7;

    // A FLAT CARD: cut by a matte a designer DREW (a solid), 2D, unparented.
    var drawnMatte = scene.layers.addSolid([1, 1, 1], "QA_DrawnMatte", 1600, 900, 1);
    var cardLayer = scene.layers.add(cardSlot);
    cardLayer.name = "QA_CardHost";
    cardLayer.scale.setValue([50, 50]);
    cardLayer.trackMatteType = TrackMatteType.ALPHA;
    cardLayer.position.setValue([500, 800]);
    cardLayer.inPoint = 2;
    cardLayer.outPoint = 8;

    // NEVER ON SCREEN - positioned entirely outside the frame.
    var offscreen = scene.layers.add(cardSlot);
    offscreen.name = "QA_Offscreen";
    offscreen.position.setValue([-4000, 540]);
    offscreen.scale.setValue([50, 50]);
    offscreen.inPoint = 0;
    offscreen.outPoint = 9;

    // NEVER ON SCREEN - held at zero opacity for its whole span.
    var faded = scene.layers.add(cardSlot);
    faded.name = "QA_FadedOut";
    faded.scale.setValue([50, 50]);
    faded.position.setValue([1400, 300]);
    faded.inPoint = 0;
    faded.outPoint = 9;
    var opacity = faded.property("ADBE Transform Group").property("ADBE Opacity");
    opacity.setValueAtTime(0, 0);
    opacity.setValueAtTime(9, 0);

    // Hebrew template wording, for the RTL and leftover-template-copy gates.
    var text = scene.layers.addText("\u05D8\u05E7\u05E1\u05D8 \u05EA\u05D1\u05E0\u05D9\u05EA");
    text.name = "QA_Hebrew";
    text.position.setValue([960, 980]);
    text.inPoint = 1;
    text.outPoint = 8;

    // A screenshot placed directly in the scene, so a TOP-LEVEL slot (one that
    // is a layer rather than a whole composition) is covered too.
    var direct = scene.layers.add(screenshot);
    direct.name = "QA_DirectImage";
    direct.scale.setValue([15, 15]);
    direct.position.setValue([1600, 800]);
    direct.inPoint = 3;
    direct.outPoint = 9;

    app.project.save(new File(PROJECT_PATH));
  } finally {
    app.endUndoGroup();
  }

  alert(
    "QA smoke project created:\n\n" +
      PROJECT_PATH +
      "\n\nNow CLOSE this project in After Effects before running the smoke test - the worker must find it closed."
  );
})();
