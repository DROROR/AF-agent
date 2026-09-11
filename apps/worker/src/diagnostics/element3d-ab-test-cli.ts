import { existsSync, unlinkSync, copyFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorkerEnv } from "../env.js";
import { ensureWorkRoot, safeJoin, sessionWorkspacePath } from "../workspace/work-root.js";
import { sessionWorkingCopyPath } from "../workspace/working-copy.js";
import { hashSourceProject } from "../inspection/hash-source-project.js";
import { HeroicSwanAeEditBridge } from "../execution/ae-edit-bridge.js";
import { HeroicSwanCompositionVerifier } from "../execution/render/verify-render-composition.js";
import { RealAerenderRunner } from "../execution/render/aerender-runner.js";
import type { SceneEditOperation } from "@dyo/schemas";

/**
 * ONE-OFF, real 2026-09-11 incident diagnostic (session a7fee3d9) - NOT a
 * new product capability, NOT wired into job dispatch, NOT shipped as part
 * of the normal worker supervisor loop. Run manually, once, via:
 *   node --env-file=.env dist\diagnostics\element3d-ab-test-cli.js
 * from the worker install directory, with the DYO Worker Scheduled Task
 * stopped first (so nothing else touches the interactive AE instance while
 * this runs) and restarted after.
 *
 * Purpose: prove or disprove that the black hard-cut at Scene 1 local
 * ~2.612s (comp-1600 / "Pre-comp 2" local time is identical, since it is
 * mounted at comp-1's local 0.000s with no offset) is caused by comp-1600's
 * "Element 3D" layer (#5, effect "Element(VIDEOCOPILOT 3DArray)") rendering
 * as solid black because the actual Video Copilot Element 3D plugin binary
 * was just confirmed ABSENT from this machine (no Element*.aex found
 * anywhere under Program Files / Program Files (x86)).
 *
 * Safety, matching every production AE-touching path in this codebase:
 *   - NEVER touches the canonical source .aep (never referenced here at all).
 *   - NEVER touches the real session working copy in place - makes its OWN
 *     disposable copy first (plain fs.copyFileSync to a new scratch path
 *     under WORK_ROOT/diagnostics/, distinct from the session's own
 *     execution-sessions/<id>/working-copy.aep) and only ever opens/edits/
 *     saves/renders THAT copy.
 *   - The one AE mutation this script performs (disabling the Element 3D
 *     layer) is the SAME allowlisted SET_LAYER_VISIBILITY operation
 *     EXECUTE_FRAME already uses in production (jsx-templates.ts's
 *     buildSetLayerVisibilityScript via HeroicSwanAeEditBridge.applyOperation) -
 *     no new JSX, no new operation type.
 *   - Reuses HeroicSwanCompositionVerifier (verify-render-composition.ts)
 *     unchanged for composition resolution/ambiguity-checking, and
 *     RealAerenderRunner/buildAerenderArgs unchanged for the actual render -
 *     the same code paths CREATE_PREVIEW/RENDER already run in production,
 *     never a second, divergent implementation.
 *   - Restores AE to the real session working copy afterward (best-effort,
 *     in a finally block) so the worker's own next dispatched job finds AE
 *     in the expected state.
 *   - Renders only a ~0.35s window (comp-1600 local ~2.4s-2.8s), never a
 *     full render, to keep this fast and disposable.
 *
 * Output: two short .mp4 clips under WORK_ROOT/diagnostics/element3d-ab-test/
 * - with-element3d.mp4 (baseline, layer left untouched) and
 * without-element3d.mp4 (layer disabled). Neither is uploaded anywhere by
 * this script - the operator scp's them to the Contabo box afterward for
 * frame-level comparison.
 */

const EXECUTION_SESSION_ID = "a7fee3d9-6d73-421e-ac11-5753ec3aa7fe";
const MANIFEST_COMPOSITION_ID = "comp-1600";
const COMPOSITION_NAME = "Pre-comp 2";
const ELEMENT_3D_LAYER_INDEX = 5;
const RENDER_SETTINGS_TEMPLATE_NAME = "Best Settings";
const OUTPUT_MODULE_TEMPLATE_NAME = "H.264 - Match Render Settings - 15 Mbps";
const WINDOW_START_SECONDS = 2.4;
const WINDOW_END_SECONDS = 2.8;
const AERENDER_TIMEOUT_MS = 5 * 60 * 1000;

function log(message: string): void {
  console.log(`[element3d-ab-test] ${message}`);
}

function fail(message: string): never {
  console.error(`[element3d-ab-test] FAILED: ${message}`);
  process.exit(1);
}

/** Pure so it can be unit-tested without a real AE connection. Clamps to [0, totalFrames-1], mirroring computeFullCompositionFrameRange's own clamping convention (aerender-args.ts). */
export function computeDiagnosticFrameRange(
  durationSeconds: number,
  frameRate: number,
  windowStartSeconds: number,
  windowEndSeconds: number
): { startFrame: number; endFrame: number } {
  const totalFrames = Math.round(durationSeconds * frameRate);
  const startFrame = Math.max(0, Math.round(windowStartSeconds * frameRate));
  const endFrame = Math.min(totalFrames - 1, Math.round(windowEndSeconds * frameRate));
  return { startFrame, endFrame };
}

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  if (!env.aeMcpPath) {
    fail("AE_MCP_PATH is not configured in .env - cannot control AE for this diagnostic.");
  }
  if (!env.aerenderPath) {
    fail("AERENDER_PATH is not configured in .env - cannot render for this diagnostic.");
  }
  const aeMcpPath = env.aeMcpPath as string;
  const aerenderPath = env.aerenderPath as string;

  const realWorkingCopyPath = sessionWorkingCopyPath(env.workRoot, EXECUTION_SESSION_ID);
  if (!existsSync(realWorkingCopyPath)) {
    fail(`Session working copy not found at ${realWorkingCopyPath} - is EXECUTION_SESSION_ID correct?`);
  }

  const diagnosticDir = safeJoin(sessionWorkspacePath(env.workRoot, "diagnostics-scratch"), "element3d-ab-test");
  ensureWorkRoot(diagnosticDir);
  const tempProjectPath = path.join(diagnosticDir, "temp-copy.aep");
  const withElementOutputPath = path.join(diagnosticDir, "with-element3d.mp4");
  const withoutElementOutputPath = path.join(diagnosticDir, "without-element3d.mp4");

  log(`Copying real working copy (${realWorkingCopyPath}) to disposable scratch copy (${tempProjectPath})...`);
  copyFileSync(realWorkingCopyPath, tempProjectPath);
  const tempHash = await hashSourceProject(tempProjectPath);
  if (!tempHash.ok) {
    fail(`could not hash the scratch copy after copying it: ${tempHash.reason}`);
  }
  log(`Scratch copy sha256: ${tempHash.value.sha256}`);

  const bridge = new HeroicSwanAeEditBridge({ aeMcpPath });
  const verifier = new HeroicSwanCompositionVerifier(aeMcpPath);
  const aerender = new RealAerenderRunner();

  let restoredRealWorkingCopy = false;
  try {
    log(`Opening scratch copy in After Effects...`);
    const openResult = await bridge.openProject(tempProjectPath);
    if (!openResult.ok) {
      fail(`could not open scratch copy: ${openResult.failureReason}`);
    }

    log(`Resolving "${MANIFEST_COMPOSITION_ID}" (expected name "${COMPOSITION_NAME}") and checking for name ambiguity...`);
    const verifyResult = await verifier.verify({
      workingProjectPath: tempProjectPath,
      manifestCompositionId: MANIFEST_COMPOSITION_ID,
      // Placeholder only - HeroicSwanCompositionVerifier re-resolves the
      // real index from MANIFEST_COMPOSITION_ID's durable numeric id before
      // ever trusting this value (see that file's own doc comment).
      aeProjectItemIndex: 1,
      compositionName: COMPOSITION_NAME
    });
    if (!verifyResult.ok) {
      fail(`composition verification failed: ${verifyResult.reason}`);
    }
    log(`Confirmed: durationSeconds=${verifyResult.durationSeconds}, frameRate=${verifyResult.frameRate}`);

    const resolved = await bridge.resolveCompositionIndex(MANIFEST_COMPOSITION_ID, COMPOSITION_NAME);
    if (!resolved.ok) {
      fail(`could not re-resolve composition for the mutation step: ${resolved.failureReason}`);
    }
    if (!resolved.resolved) {
      fail(`"${MANIFEST_COMPOSITION_ID}" carries no durable numeric id - cannot safely target it for mutation.`);
    }
    const aeProjectItemIndex = resolved.aeProjectItemIndex;

    const { startFrame, endFrame } = computeDiagnosticFrameRange(
      verifyResult.durationSeconds,
      verifyResult.frameRate,
      WINDOW_START_SECONDS,
      WINDOW_END_SECONDS
    );
    log(`Diagnostic frame range: ${startFrame}-${endFrame} (local ${WINDOW_START_SECONDS}s-${WINDOW_END_SECONDS}s @ ${verifyResult.frameRate}fps)`);

    // ---- Pass A: baseline, Element 3D layer untouched (whatever it currently is - enabled) ----
    if (existsSync(withElementOutputPath)) {
      unlinkSync(withElementOutputPath);
    }
    log("Rendering pass A (Element 3D layer untouched)...");
    const passAResult = await aerender.run({
      executablePath: aerenderPath,
      projectPath: tempProjectPath,
      compName: COMPOSITION_NAME,
      renderSettingsTemplateName: RENDER_SETTINGS_TEMPLATE_NAME,
      outputModuleTemplateName: OUTPUT_MODULE_TEMPLATE_NAME,
      outputPath: withElementOutputPath,
      startFrame,
      endFrame,
      timeoutMs: AERENDER_TIMEOUT_MS
    });
    log(`Pass A: ok=${passAResult.ok} exitCode=${passAResult.exitCode} timedOut=${passAResult.timedOut}`);
    if (passAResult.stderr) {
      log(`Pass A stderr (tail): ${passAResult.stderr.slice(-2000)}`);
    }
    if (!passAResult.ok || passAResult.exitCode !== 0 || !existsSync(withElementOutputPath)) {
      fail("Pass A render did not produce a valid output file - see log above.");
    }

    // ---- Disable the Element 3D layer, save the scratch copy ----
    log(`Disabling layer ${ELEMENT_3D_LAYER_INDEX} ("Element 3D") in the scratch copy...`);
    const disableOperation: SceneEditOperation = {
      type: "SET_LAYER_VISIBILITY",
      manifestPlaceholderId: "diagnostic-element3d-ab-test",
      layerIndex: ELEMENT_3D_LAYER_INDEX,
      visible: false
    };
    const applyResult = await bridge.applyOperation({
      aeProjectItemIndex,
      compositionName: COMPOSITION_NAME,
      operation: disableOperation
    });
    if (!applyResult.ok) {
      fail(`could not disable the Element 3D layer: ${applyResult.failureReason}`);
    }
    log(`Layer visibility: previousValue=${JSON.stringify(applyResult.previousValue)} resultingValue=${JSON.stringify(applyResult.resultingValue)}`);

    const saveResult = await bridge.saveProject();
    if (!saveResult.ok) {
      fail(`could not save the scratch copy with the layer disabled: ${saveResult.failureReason}`);
    }
    log("Scratch copy saved with Element 3D layer disabled.");

    // ---- Pass B: Element 3D layer disabled ----
    if (existsSync(withoutElementOutputPath)) {
      unlinkSync(withoutElementOutputPath);
    }
    log("Rendering pass B (Element 3D layer disabled)...");
    const passBResult = await aerender.run({
      executablePath: aerenderPath,
      projectPath: tempProjectPath,
      compName: COMPOSITION_NAME,
      renderSettingsTemplateName: RENDER_SETTINGS_TEMPLATE_NAME,
      outputModuleTemplateName: OUTPUT_MODULE_TEMPLATE_NAME,
      outputPath: withoutElementOutputPath,
      startFrame,
      endFrame,
      timeoutMs: AERENDER_TIMEOUT_MS
    });
    log(`Pass B: ok=${passBResult.ok} exitCode=${passBResult.exitCode} timedOut=${passBResult.timedOut}`);
    if (passBResult.stderr) {
      log(`Pass B stderr (tail): ${passBResult.stderr.slice(-2000)}`);
    }
    if (!passBResult.ok || passBResult.exitCode !== 0 || !existsSync(withoutElementOutputPath)) {
      fail("Pass B render did not produce a valid output file - see log above.");
    }

    log("Restoring the real session working copy in After Effects...");
    const restoreResult = await bridge.openProject(realWorkingCopyPath);
    restoredRealWorkingCopy = restoreResult.ok;
    log(`Restore: ok=${restoreResult.ok}`);

    log("DONE.");
    log(`Pass A (Element 3D enabled):  ${withElementOutputPath}`);
    log(`Pass B (Element 3D disabled): ${withoutElementOutputPath}`);
  } finally {
    if (!restoredRealWorkingCopy) {
      try {
        await bridge.openProject(realWorkingCopyPath);
      } catch {
        // best-effort only - already logged/handled above if this was reached via the happy path
      }
    }
  }
}

// Guarded so this file can be imported by its own unit test (for
// computeDiagnosticFrameRange) without immediately running main() - main()
// only runs when this file is executed directly, e.g.
// `node dist/diagnostics/element3d-ab-test-cli.js`.
//
// REAL BUG (2026-09-11, first attempted run on FAHADNAKASH): the previous
// version of this check built the comparison URL by hand as
// `file://${path.resolve(process.argv[1])}` - on Windows, path.resolve
// returns a backslash path (e.g. "C:\DYO-Agent\..."), producing
// "file://C:\DYO-Agent\..." which can NEVER equal Node's own real
// import.meta.url for that same file (Node always normalizes to forward
// slashes with a triple-slash drive prefix and percent-encoding, e.g.
// "file:///C:/DYO-Agent/..."). isDirectlyExecuted was therefore always
// false on Windows, main() never ran, and `node ...cli.js` exited 0
// immediately with no output at all - exactly the symptom observed.
// pathToFileURL is Node's own platform-correct converter for exactly this
// comparison; never hand-build a file:// URL again.
const isDirectlyExecuted = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectlyExecuted) {
  main().catch((error) => {
    fail(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
  });
}
