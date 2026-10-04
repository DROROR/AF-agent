import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { buildCaptureStillScript, type FixedJsxScript } from "../execution/jsx-templates.js";
import { unwrapJsxResult } from "../execution/unwrap-jsx-result.js";
import type { ToolCallResult } from "./heroic-swan-mcp-client.js";
import { waitForCapturedFrame, type CapturedFrameWaitOptions } from "./wait-for-captured-frame.js";

/**
 * ONE STILL, TO A PATH THIS WORKER CHOSE (2026-10-04) - see
 * buildCaptureStillScript for the incident. Used by both the scene preview
 * and the executed-frame preview.
 *
 * The rule that makes it survive a broken call: the worker knows where the
 * picture will be, so it looks there whether the call that asked for it
 * answered, timed out or lost its connection. After Effects goes on
 * rendering a still it has started; only AE itself saying "this failed"
 * ends the wait early. A picture that never arrives is still reported as
 * exactly that, with the call's own failure beside it.
 */

/** How long to look for the file when the call itself did not answer - AE may still be rendering. */
export const CAPTURE_WAIT_AFTER_FAILED_CALL_MS = 120_000;

export interface StillCaptureClient {
  runFixedInspectionScript(script: FixedJsxScript, timeoutMsOverride?: number): Promise<ToolCallResult>;
}

export interface CaptureStillOptions {
  aeProjectItemIndex: number;
  timestampSeconds: number;
  /** Budget for the one script call. */
  callTimeoutMs?: number;
  /** Test-only: where stills are written, and how long they are waited for. */
  previewsDirectory?: string;
  capturedFrameWait?: CapturedFrameWaitOptions;
  waitAfterFailedCallMs?: number;
}

export type CaptureStillResult = { ok: true; path: string; bytes: number } | { ok: false; reason: string };

const scriptStatusSchema = z.union([
  z.object({ ok: z.literal(true), compositionName: z.string() }),
  z.object({ ok: z.literal(false), failureReason: z.string() })
]);

/** The same folder ae-mcp's own capture writes to, so nothing new on disk needs to be allowed or cleaned. */
export function defaultPreviewsDirectory(): string {
  return join(homedir(), ".ae-mcp", "previews");
}

export async function captureStill(client: StillCaptureClient, options: CaptureStillOptions): Promise<CaptureStillResult> {
  const directory = options.previewsDirectory ?? defaultPreviewsDirectory();
  try {
    await mkdir(directory, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `could not create the preview folder ${directory}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const path = join(directory, `dyo_still_${String(options.aeProjectItemIndex)}_${String(Date.now())}_${randomUUID().slice(0, 8)}.png`);
  const script = buildCaptureStillScript(options.aeProjectItemIndex, options.timestampSeconds, path);

  const call = await client.runFixedInspectionScript(script, options.callTimeoutMs);

  let callProblem: string | null = null;
  if (!call.ok) {
    callProblem = call.error.message;
  } else {
    const unwrapped = unwrapJsxResult(call.content);
    const status = unwrapped.ok ? scriptStatusSchema.safeParse(unwrapped.value) : null;
    if (status?.success && !status.data.ok) {
      // After Effects itself said no - there is no picture to wait for.
      return { ok: false, reason: status.data.failureReason };
    }
    if (!status?.success) {
      callProblem = unwrapped.ok ? "the capture script returned an unexpected result" : unwrapped.reason;
    }
  }

  const wait: CapturedFrameWaitOptions =
    callProblem === null
      ? (options.capturedFrameWait ?? {})
      : { ...options.capturedFrameWait, timeoutMs: options.waitAfterFailedCallMs ?? CAPTURE_WAIT_AFTER_FAILED_CALL_MS };
  const captured = await waitForCapturedFrame(path, wait);
  if (captured.ok) {
    return { ok: true, path, bytes: captured.bytes };
  }
  return {
    ok: false,
    reason: callProblem === null ? captured.reason : `the capture call did not answer (${callProblem}) and no picture was written afterwards (${captured.reason})`
  };
}
