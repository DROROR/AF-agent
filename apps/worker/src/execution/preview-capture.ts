import { stat } from "node:fs/promises";
import { HeroicSwanMcpClient } from "../inspection/heroic-swan-mcp-client.js";
import { parseCaptureFrame } from "../inspection/parse-mcp-shapes.js";

/**
 * Real preview-frame capture for EXECUTE_FRAME, reusing the SAME
 * read-only `ae_capture_frame` tool (and the same "verify the file on
 * disk ourselves, never trust a self-reported byte count" pattern)
 * already proven in heroic-swan-scene-evidence-inspector.ts. This is
 * never the final render (CLAUDE.md Safety Rule 5: editing/rendering are
 * separate stages) - one verified still frame is the whole contract
 * (Phase 7A section 7 / execute-scene-edit.ts's sceneEditResultSchema).
 */
export interface PreviewCaptureSuccess {
  ok: true;
  path: string;
  bytes: number;
  timestampSeconds: number;
}

export interface PreviewCaptureFailure {
  ok: false;
  reason: string;
}

export type PreviewCaptureResult = PreviewCaptureSuccess | PreviewCaptureFailure;

export interface PreviewCapture {
  capture(params: { aeProjectItemIndex: number; timestampSeconds: number }): Promise<PreviewCaptureResult>;
}

export class PreviewCaptureUnavailableError extends Error {
  constructor(reason?: string) {
    super(reason ?? "Preview capture cannot run: no real ae-mcp transport is configured (AE_MCP_PATH is unset).");
    this.name = "PreviewCaptureUnavailableError";
  }
}

/** Honest stub - never fabricates a preview. */
export class NotAvailablePreviewCapture implements PreviewCapture {
  async capture(_params: { aeProjectItemIndex: number; timestampSeconds: number }): Promise<PreviewCaptureResult> {
    throw new PreviewCaptureUnavailableError();
  }
}

/**
 * REAL 2026-09-15 FAILURE (job 60fcab36): the first capture after nine real
 * edits (two large imports) ran past the MCP client's flat 15 s default -
 * "MCP error -32001: Request timed out" - while After Effects kept rendering
 * the still (its bridge heartbeat stopped until it finished). A still render
 * of an edited scene legitimately takes longer than an inspection read, so
 * capture gets its own bounds: still finite, never retried automatically
 * (a second request would only queue another render behind the first). A
 * timed-out capture is retried as a capture-only resume instead.
 */
export const DEFAULT_CAPTURE_CONNECT_TIMEOUT_MS = 60_000;
export const DEFAULT_CAPTURE_CALL_TIMEOUT_MS = 180_000;

export interface HeroicSwanPreviewCaptureTimeouts {
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
}

export class HeroicSwanPreviewCapture implements PreviewCapture {
  readonly connectTimeoutMs: number;
  readonly callTimeoutMs: number;

  constructor(
    private readonly aeMcpPath: string,
    timeouts: HeroicSwanPreviewCaptureTimeouts = {}
  ) {
    this.connectTimeoutMs = timeouts.connectTimeoutMs ?? DEFAULT_CAPTURE_CONNECT_TIMEOUT_MS;
    this.callTimeoutMs = timeouts.callTimeoutMs ?? DEFAULT_CAPTURE_CALL_TIMEOUT_MS;
  }

  async capture({
    aeProjectItemIndex,
    timestampSeconds
  }: {
    aeProjectItemIndex: number;
    timestampSeconds: number;
  }): Promise<PreviewCaptureResult> {
    const client = new HeroicSwanMcpClient({ aeMcpPath: this.aeMcpPath, timeoutMs: this.connectTimeoutMs });
    try {
      await client.connect();
    } catch (error) {
      await client.close();
      return { ok: false, reason: `could not connect to ae-mcp: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      const result = await client.callTool("ae_capture_frame", { comp_index: aeProjectItemIndex, time: timestampSeconds }, this.callTimeoutMs);
      if (!result.ok) {
        return { ok: false, reason: `ae_capture_frame failed: ${result.error.message}` };
      }
      const parsed = parseCaptureFrame(result.content);
      if (!parsed.ok) {
        return { ok: false, reason: `ae_capture_frame response did not match the confirmed shape: ${parsed.reason}` };
      }
      try {
        // Verified independently via this worker's own filesystem stat
        // call - never trusted from AE's self-report alone (matches the
        // scene-evidence inspector's own "actual verified image existence").
        const fileStat = await stat(parsed.value.path);
        if (!fileStat.isFile() || fileStat.size <= 0) {
          return { ok: false, reason: "captured preview file exists but is empty or not a regular file" };
        }
        return { ok: true, path: parsed.value.path, bytes: fileStat.size, timestampSeconds };
      } catch (error) {
        return {
          ok: false,
          reason: `could not verify the captured preview file on disk (${error instanceof Error ? error.message : String(error)})`
        };
      }
    } finally {
      await client.close();
    }
  }
}
