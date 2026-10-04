import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureStill, type StillCaptureClient } from "./capture-still.js";
import { SCENE_PREVIEW_CAPTURE_CALL_TIMEOUT_MS } from "./heroic-swan-scene-evidence-inspector.js";
import { deriveWatchdogBudgetMs, WATCHDOG_PREVIEW_CAPTURE_CALL_TIMEOUT_MS } from "../domain/job-watchdog.js";
import { CAPTURE_WAIT_AFTER_FAILED_CALL_MS } from "./capture-still.js";
import type { ToolCallResult } from "./heroic-swan-mcp-client.js";

/**
 * REAL 2026-10-04 INCIDENT: every still of a template's heavy master
 * composition failed with "ae_capture_frame failed: MCP error -32000:
 * Connection closed". The worker now asks for the still itself, to a path it
 * chose, and looks there whatever became of the call.
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-still-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const answer = (value: unknown): ToolCallResult => ({ ok: true, content: [{ type: "text", text: JSON.stringify({ result: JSON.stringify(value) }) }] });
const pathIn = (script: string): string => JSON.parse(/new File\(("(?:[^"\\]|\\.)*")\)/.exec(script)![1]!) as string;

function client(behaviour: (path: string) => Promise<ToolCallResult>): StillCaptureClient & { scripts: string[] } {
  const scripts: string[] = [];
  return {
    scripts,
    runFixedInspectionScript: async (script) => {
      scripts.push(script);
      return behaviour(pathIn(script));
    }
  };
}
const options = () => ({ aeProjectItemIndex: 7, timestampSeconds: 2.5, previewsDirectory: dir, capturedFrameWait: { timeoutMs: 300, pollIntervalMs: 20 }, waitAfterFailedCallMs: 600 });

describe("the worker's own still capture", () => {
  it("writes to a path inside the folder it was given and reports the bytes it read from disk itself", async () => {
    const c = client(async (path) => {
      await writeFile(path, Buffer.from([1, 2, 3]));
      return answer({ ok: true, compositionName: "Any" });
    });
    const result = await captureStill(c, options());
    expect(result).toMatchObject({ ok: true, bytes: 3 });
    expect(result.ok && result.path.startsWith(dir)).toBe(true);
    expect(c.scripts[0]).toContain("app.project.item(7)");
    expect(c.scripts[0]).toContain("saveFrameToPng(2.5,");
    // A still render never runs inside an undo group (CLAUDE.md Safety Rule 4).
    expect(c.scripts[0]).not.toContain("beginUndoGroup");
  });

  it("the call loses its connection, After Effects writes the picture a moment later: delivered", async () => {
    const c = client(async (path) => {
      setTimeout(() => void writeFile(path, Buffer.from([9, 9])), 150);
      return { ok: false, error: { code: "TRANSPORT_ERROR", message: "MCP error -32000: Connection closed" } };
    });
    expect(await captureStill(c, options())).toMatchObject({ ok: true, bytes: 2 });
  });

  it("the call is lost and no picture ever arrives: says both, invents nothing", async () => {
    const c = client(async () => ({ ok: false, error: { code: "TRANSPORT_ERROR", message: "MCP error -32000: Connection closed" } }));
    const result = await captureStill(c, options());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/Connection closed/);
    expect(!result.ok && result.reason).toMatch(/no picture was written/);
  });

  it("After Effects itself refuses: fails at once with its reason, without waiting", async () => {
    const started = Date.now();
    const c = client(async () => answer({ ok: false, failureReason: "saveFrameToPng failed: no" }));
    expect(await captureStill(c, { ...options(), waitAfterFailedCallMs: 60_000 })).toEqual({ ok: false, reason: "saveFrameToPng failed: no" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("the call answers but the file never appears: not trusted", async () => {
    const c = client(async () => answer({ ok: true, compositionName: "Any" }));
    const result = await captureStill(c, options());
    expect(!result.ok && result.reason).toMatch(/could not verify/);
  });

  it("the job watchdog allows for the capture's real worst case", () => {
    expect(WATCHDOG_PREVIEW_CAPTURE_CALL_TIMEOUT_MS).toBe(SCENE_PREVIEW_CAPTURE_CALL_TIMEOUT_MS);
    const budget = deriveWatchdogBudgetMs({ operation: "INSPECT_SCENE_EVIDENCE", payload: { layerIndices: [], previewTimestampSeconds: 1 } } as never);
    expect(budget).toBeGreaterThan(SCENE_PREVIEW_CAPTURE_CALL_TIMEOUT_MS + CAPTURE_WAIT_AFTER_FAILED_CALL_MS);
  });
});
