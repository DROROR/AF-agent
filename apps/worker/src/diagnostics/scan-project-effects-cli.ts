import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorkerEnv } from "../env.js";
import { ensureWorkRoot, safeJoin } from "../workspace/work-root.js";
import { hashSourceProject } from "../inspection/hash-source-project.js";
import { HeroicSwanMcpClient } from "../inspection/heroic-swan-mcp-client.js";
import { unwrapJsxResult } from "../execution/unwrap-jsx-result.js";
import { buildOpenProjectScript, buildScanProjectEffectsScript } from "../execution/jsx-templates.js";

/**
 * Real 2026-09-11 incident (candidate "dro-tempelate-converted-v26.aep",
 * 51 compositions, 50 nested under one top-level scene "!Render"): the
 * dashboard's "Describe Any Composition" diagnostic checks ONE
 * composition at a time and is gated behind an already-executed scene
 * preview - both disproportionate just to check for a third-party plugin
 * dependency before any scene mapping/execution decision has been made
 * for this candidate. This one-off, read-only CLI instead scans EVERY
 * composition in the project in a single ae_run_jsx call
 * (buildScanProjectEffectsScript - see that function's own doc comment
 * for why this carries none of the "one more round trip per composition"
 * risk the per-composition path would).
 *
 * Run manually, once, via:
 *   node --env-file=.env dist\diagnostics\scan-project-effects-cli.js <path-to-aep>
 * from the worker install directory. Takes the real .aep path to scan as
 * its one CLI argument - never hardcoded to any one template.
 *
 * Safety:
 *   - NEVER touches the canonical source or any session's real working
 *     copy - makes its own disposable scratch copy first (plain
 *     fs.copyFileSync) and only ever opens/reads that copy.
 *   - Uses ONLY the read-only HeroicSwanMcpClient (ae_run_jsx via
 *     runFixedInspectionScript) - never the mutation client, never
 *     AeEditBridge. Never calls saveProject.
 *   - The scan script itself (buildScanProjectEffectsScript) never
 *     mutates project state - see that function's own doc comment.
 */

function log(message: string): void {
  console.log(`[scan-project-effects] ${message}`);
}

function fail(message: string): never {
  console.error(`[scan-project-effects] FAILED: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (!targetPath) {
    fail("usage: node dist/diagnostics/scan-project-effects-cli.js <path-to-aep>");
  }
  if (!existsSync(targetPath)) {
    fail(`source project not found: ${targetPath}`);
  }

  const env = loadWorkerEnv();
  if (!env.aeMcpPath) {
    fail("AE_MCP_PATH is not configured in .env - cannot control AE for this diagnostic.");
  }
  const aeMcpPath = env.aeMcpPath as string;

  const scratchDir = safeJoin(env.workRoot, "diagnostics-scratch", "scan-project-effects");
  ensureWorkRoot(scratchDir);
  const scratchPath = path.join(scratchDir, "scratch.aep");

  log(`Copying "${targetPath}" to disposable scratch copy "${scratchPath}"...`);
  copyFileSync(targetPath, scratchPath);
  const sourceHash = await hashSourceProject(targetPath);
  const scratchHash = await hashSourceProject(scratchPath);
  if (sourceHash.ok && scratchHash.ok && sourceHash.value.sha256 !== scratchHash.value.sha256) {
    fail(`scratch copy sha256 (${scratchHash.value.sha256}) does not match the source's (${sourceHash.value.sha256}) - refusing to scan an unverified copy`);
  }
  log(`Source sha256: ${sourceHash.ok ? sourceHash.value.sha256 : "could not hash"}`);

  const client = new HeroicSwanMcpClient({ aeMcpPath });
  try {
    await client.connect();
  } catch (error) {
    fail(`could not connect to ae-mcp: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    log("Opening scratch copy in After Effects...");
    const openResult = await client.runFixedInspectionScript(buildOpenProjectScript(scratchPath));
    if (!openResult.ok) {
      fail(`open-project script failed: ${openResult.error.message}`);
    }
    const unwrappedOpen = unwrapJsxResult(openResult.content);
    if (!unwrappedOpen.ok) {
      fail(`could not parse open-project script response: ${unwrappedOpen.reason}`);
    }
    const openedValue = unwrappedOpen.value as { ok?: boolean; resultingValue?: { openedPath?: string | null } };
    if (!openedValue.ok || openedValue.resultingValue?.openedPath !== scratchPath) {
      fail(`AE did not report the scratch copy open (got: ${JSON.stringify(openedValue)}) - refusing to scan the wrong project`);
    }
    log("Confirmed the scratch copy is open. Scanning every composition for applied effects...");

    const scanResult = await client.runFixedInspectionScript(buildScanProjectEffectsScript());
    if (!scanResult.ok) {
      fail(`scan script failed: ${scanResult.error.message}`);
    }
    const unwrappedScan = unwrapJsxResult(scanResult.content);
    if (!unwrappedScan.ok) {
      fail(`could not parse scan script response: ${unwrappedScan.reason}`);
    }
    const scanValue = unwrappedScan.value as {
      ok?: boolean;
      failureReason?: string;
      compositionCount?: number;
      compositionsWithEffects?: Array<{
        aeProjectItemIndex: number;
        compositionId: number;
        compositionName: string;
        layers: Array<{ layerIndex: number; layerName: string; enabled: boolean; effects: Array<{ name: string; matchName: string; enabled: boolean }> }>;
      }>;
    };
    if (!scanValue.ok) {
      fail(`scan script reported failure: ${scanValue.failureReason ?? "unknown reason"}`);
    }

    log(`DONE. Scanned ${scanValue.compositionCount} project items.`);
    const compsWithEffects = scanValue.compositionsWithEffects ?? [];
    if (compsWithEffects.length === 0) {
      log("No layer in any composition has any applied effect at all.");
    } else {
      log(`${compsWithEffects.length} composition(s) have at least one layer with an applied effect:`);
      for (const comp of compsWithEffects) {
        log(`  Composition "${comp.compositionName}" (id=${comp.compositionId}, index=${comp.aeProjectItemIndex}):`);
        for (const layer of comp.layers) {
          for (const effect of layer.effects) {
            const nativeFlag = effect.matchName.startsWith("ADBE ") ? "native (ADBE-prefixed)" : "*** NON-ADBE - LIKELY THIRD-PARTY ***";
            log(`    Layer "${layer.layerName}" (index=${layer.layerIndex}, enabled=${layer.enabled}): effect "${effect.name}" matchName="${effect.matchName}" enabled=${effect.enabled} - ${nativeFlag}`);
          }
        }
      }
    }
    log("Full raw JSON below for independent verification:");
    console.log(JSON.stringify(scanValue));
  } finally {
    await client.close();
  }
}

const isDirectlyExecuted = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectlyExecuted) {
  main().catch((error) => {
    fail(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
  });
}
