import { stat } from "node:fs/promises";

/**
 * REAL 2026-10-02 FAILURE (project fe32ffac, composition "!MAIN"): the
 * capture job SUCCEEDED but carried no preview - "could not verify the
 * captured preview file on disk (ENOENT ... _MAIN_1790952469969.png)" -
 * while the nine lighter compositions of the same template all produced
 * their frame. ae-mcp's own `view.captureFrame` (host-scripts/
 * ae-mcp-methods.jsx) returns the output path straight after
 * `comp.saveFrameToPng()`, reporting `bytes: 0` when the file is not there
 * yet - it never waits for the write. A heavy composition (44 s, 76 nested
 * compositions) finishes writing its still after that call has already
 * returned, so a single immediate `stat` saw nothing.
 *
 * The file is therefore given a bounded window to appear and to stop
 * growing. Still finite, still verified by this worker's own filesystem
 * read (never AE's self-report), and a frame that never arrives is still
 * reported as exactly that.
 */
export const DEFAULT_CAPTURED_FRAME_WAIT_TIMEOUT_MS = 30_000;
export const DEFAULT_CAPTURED_FRAME_POLL_INTERVAL_MS = 500;

export interface CapturedFrameWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type CapturedFrameWaitResult = { ok: true; bytes: number } | { ok: false; reason: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves once `filePath` is a regular, non-empty file whose size was the
 * same on two consecutive reads (a file still being written is never
 * handed on as a finished frame). Never throws.
 */
export async function waitForCapturedFrame(filePath: string, options: CapturedFrameWaitOptions = {}): Promise<CapturedFrameWaitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CAPTURED_FRAME_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_CAPTURED_FRAME_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  let previousSize: number | null = null;
  let lastProblem = "the file never appeared";
  for (;;) {
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        return { ok: false, reason: "captured preview file exists but is empty or not a regular file" };
      }
      if (fileStat.size > 0 && fileStat.size === previousSize) {
        return { ok: true, bytes: fileStat.size };
      }
      previousSize = fileStat.size;
      lastProblem = fileStat.size > 0 ? "the file was still being written" : "the file stayed empty";
    } catch (error) {
      previousSize = null;
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) {
      break;
    }
    await sleep(pollIntervalMs);
  }

  if (previousSize === 0) {
    return { ok: false, reason: "captured preview file exists but is empty or not a regular file" };
  }
  return {
    ok: false,
    reason: `could not verify the captured preview file on disk after waiting ${Math.round(timeoutMs / 1000)} s (${lastProblem})`
  };
}
