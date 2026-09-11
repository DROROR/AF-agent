import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Real 2026-09-11 incident: the first version of this diagnostic imported
 * `buildScanProjectEffectsScript`/`buildOpenProjectScript` from
 * ../execution/jsx-templates.js - a real compiled sibling file already
 * installed on FAHADNAKASH, but from an OLDER build that predates those
 * exports. Copying only this one new .js file onto an otherwise-unchanged
 * install broke immediately: "does not provide an export named
 * buildScanProjectEffectsScript". Fixed by making this file GENUINELY
 * self-contained - its only imports are Node built-ins and
 * @modelcontextprotocol/sdk (an npm package resolved from node_modules,
 * already installed and unchanged - not a relative sibling file that
 * could ever be stale). It can be dropped anywhere and run with plain
 * `node`, entirely independent of whatever build the rest of the worker
 * install happens to be on - no Worker restart, no other file to update.
 *
 * The two JSX script bodies below are DELIBERATE, INTENTIONAL duplicates
 * of jsx-templates.ts's real buildOpenProjectScript/
 * buildScanProjectEffectsScript - see
 * __tests__/scan-project-effects-cli.test.ts's own "byte-identical to the
 * real jsx-templates.ts functions" test, which fails loudly the moment
 * these two copies would otherwise silently drift apart.
 *
 * Run manually, once, via:
 *   node scan-project-effects-cli.js <AE_MCP_PATH> <path-to-aep>
 * Takes AE_MCP_PATH as an explicit argument (rather than reading .env)
 * specifically so this file has ZERO dependency on this worker's own
 * env.js/config either - genuinely standalone.
 *
 * Safety:
 *   - NEVER touches the canonical source or any session's real working
 *     copy - makes its own disposable scratch copy first (plain
 *     fs.copyFileSync, next to itself) and only ever opens/reads that copy.
 *   - Spawns its own separate `node <AE_MCP_PATH>/dist/index.js serve`
 *     connection (the same real ae-mcp bridge the installed Worker
 *     itself already uses) - never touches the Worker's own running
 *     process, its Scheduled Task, or its credentials/config in any way.
 *   - Only ever sends the two fixed, read-only JSX bodies below via
 *     `ae_run_jsx` - never saves the project, never mutates anything.
 */

const JSON_STRINGIFY_POLYFILL = String.raw`if (typeof JSON === "undefined") { JSON = {}; }
  if (typeof JSON.stringify !== "function") {
    var __dyoJsonQuoteString = function (__s) {
      var __out = "\"";
      for (var __qi = 0; __qi < __s.length; __qi++) {
        var __qc = __s.charAt(__qi);
        var __qcode = __s.charCodeAt(__qi);
        if (__qc === "\"" || __qc === "\\") {
          __out += "\\" + __qc;
        } else if (__qc === "\n") {
          __out += "\\n";
        } else if (__qc === "\r") {
          __out += "\\r";
        } else if (__qc === "\t") {
          __out += "\\t";
        } else if (__qcode < 0x20) {
          __out += "\\u" + ("0000" + __qcode.toString(16)).slice(-4);
        } else {
          __out += __qc;
        }
      }
      return __out + "\"";
    };
    JSON.stringify = function __dyoJsonStringify(__value) {
      if (__value === null || __value === undefined) { return "null"; }
      var __type = typeof __value;
      if (__type === "number") { return isFinite(__value) ? String(__value) : "null"; }
      if (__type === "boolean") { return __value ? "true" : "false"; }
      if (__type === "string") { return __dyoJsonQuoteString(__value); }
      if (__value instanceof Array) {
        var __items = [];
        for (var __ai = 0; __ai < __value.length; __ai++) {
          __items.push(JSON.stringify(__value[__ai]));
        }
        return "[" + __items.join(",") + "]";
      }
      if (__type === "object") {
        var __parts = [];
        for (var __key in __value) {
          if (!__value.hasOwnProperty(__key)) { continue; }
          __parts.push(__dyoJsonQuoteString(__key) + ":" + JSON.stringify(__value[__key]));
        }
        return "{" + __parts.join(",") + "}";
      }
      return "null";
    };
  }
  `;

export function buildOpenProjectScript(sourceProjectPath: string): string {
  const pathLiteral = JSON.stringify(sourceProjectPath);
  return `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO INSPECT_TEMPLATE: ensure target project open")});
  var __result = null;
  try {
    var __targetFile = new File(${pathLiteral});
    var __opened;
    app.beginSuppressDialogs();
    try {
      __opened = app.open(__targetFile);
    } finally {
      app.endSuppressDialogs(false);
    }
    if (!__opened) {
      __result = JSON.stringify({ ok: false, failureReason: "app.open() did not return an opened project" });
    } else {
      __result = JSON.stringify({
        ok: true,
        resultingValue: {
          openedPath: app.project && app.project.file ? app.project.file.fsName : null,
          openedName: app.project ? app.project.name : null
        }
      });
    }
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
}

export function buildScanProjectEffectsScript(): string {
  return `${JSON_STRINGIFY_POLYFILL}app.beginUndoGroup(${JSON.stringify("DYO SCAN_PROJECT_EFFECTS")});
  var __result = null;
  try {
    var __compositions = [];
    for (var __itemIndex = 1; __itemIndex <= app.project.numItems; __itemIndex++) {
      var __item = null;
      try {
        __item = app.project.item(__itemIndex);
      } catch (__itemLookupError) {
        continue;
      }
      if (!(__item instanceof CompItem)) {
        continue;
      }
      var __layers = [];
      for (var __i = 1; __i <= __item.numLayers; __i++) {
        try {
          var __layer = __item.layer(__i);
          var __effects = [];
          try {
            var __effectsGroup = __layer.property("ADBE Effect Parade");
            if (__effectsGroup) {
              for (var __e = 1; __e <= __effectsGroup.numProperties; __e++) {
                var __eff = __effectsGroup.property(__e);
                __effects.push({ name: __eff.name, matchName: __eff.matchName, enabled: __eff.enabled });
              }
            }
          } catch (__effectsError) {
            // No effects group on this layer type - never fails the rest of the scan.
          }
          if (__effects.length > 0) {
            __layers.push({ layerIndex: __layer.index, layerName: __layer.name, enabled: __layer.enabled, effects: __effects });
          }
        } catch (__layerReadError) {
          // A single unreadable layer never fails the whole scan.
        }
      }
      if (__layers.length > 0) {
        __compositions.push({ aeProjectItemIndex: __itemIndex, compositionId: __item.id, compositionName: __item.name, layers: __layers });
      }
    }
    __result = JSON.stringify({ ok: true, compositionCount: app.project.numItems, compositionsWithEffects: __compositions });
  } catch (__unexpectedError) {
    __result = JSON.stringify({
      ok: false,
      failureReason: "unexpected error: " + (__unexpectedError && __unexpectedError.toString ? __unexpectedError.toString() : String(__unexpectedError))
    });
  } finally {
    app.endUndoGroup();
  }
  return __result;`;
}

function log(message: string): void {
  console.log(`[scan-project-effects] ${message}`);
}

function fail(message: string): never {
  console.error(`[scan-project-effects] FAILED: ${message}`);
  process.exit(1);
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Same double-JSON-envelope unwrap every ae_run_jsx caller in this codebase uses - see ae-edit-bridge.ts's own doc comment for the full trace, duplicated here only because this file has no other dependency on that module. */
function unwrapJsxResult(content: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!Array.isArray(content)) {
    return { ok: false, reason: "content is not an array" };
  }
  const textBlock = content.find((block): block is { type: "text"; text: string } => Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text");
  if (!textBlock) {
    return { ok: false, reason: "no text content block found" };
  }
  let outer: unknown;
  try {
    outer = JSON.parse(textBlock.text);
  } catch (error) {
    return { ok: false, reason: `outer JSON parse failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof outer !== "object" || outer === null || typeof (outer as { result?: unknown }).result !== "string") {
    return { ok: false, reason: "outer envelope did not match {result: string}" };
  }
  try {
    return { ok: true, value: JSON.parse((outer as { result: string }).result) };
  } catch (error) {
    return { ok: false, reason: `inner JSON parse failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function main(): Promise<void> {
  const aeMcpPath = process.argv[2];
  const targetPath = process.argv[3];
  if (!aeMcpPath || !targetPath) {
    fail("usage: node scan-project-effects-cli.js <AE_MCP_PATH> <path-to-aep>");
  }
  if (!existsSync(targetPath)) {
    fail(`source project not found: ${targetPath}`);
  }

  const scratchDir = path.join(path.dirname(targetPath), "scan-project-effects-scratch");
  mkdirSync(scratchDir, { recursive: true });
  const scratchPath = path.join(scratchDir, "scratch.aep");

  log(`Copying "${targetPath}" to disposable scratch copy "${scratchPath}"...`);
  copyFileSync(targetPath, scratchPath);
  const sourceSha256 = await hashFile(targetPath);
  const scratchSha256 = await hashFile(scratchPath);
  if (sourceSha256 !== scratchSha256) {
    fail(`scratch copy sha256 (${scratchSha256}) does not match the source's (${sourceSha256}) - refusing to scan an unverified copy`);
  }
  log(`Source sha256: ${sourceSha256}`);

  const scriptPath = path.join(aeMcpPath, "dist", "index.js");
  const transport = new StdioClientTransport({ command: "node", args: [scriptPath, "serve"], stderr: "pipe" });
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "dyo-video-agent-worker-diagnostic", version: "0.1.0" }, { capabilities: {} });

  try {
    await client.connect(transport, { timeout: 30_000 });
  } catch (error) {
    fail(`could not connect to ae-mcp: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    log("Opening scratch copy in After Effects...");
    const openResult = await client.callTool({ name: "ae_run_jsx", arguments: { code: buildOpenProjectScript(scratchPath), mode: "unsafe" } }, undefined, { timeout: 60_000 });
    if (openResult.isError) {
      fail(`open-project script failed: ${JSON.stringify(openResult.content)}`);
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

    const scanResult = await client.callTool({ name: "ae_run_jsx", arguments: { code: buildScanProjectEffectsScript(), mode: "unsafe" } }, undefined, { timeout: 120_000 });
    if (scanResult.isError) {
      fail(`scan script failed: ${JSON.stringify(scanResult.content)}`);
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
