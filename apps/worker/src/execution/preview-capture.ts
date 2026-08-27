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

export class HeroicSwanPreviewCapture implements PreviewCapture {
  constructor(private readonly aeMcpPath: string) {}

  async capture({
    aeProjectItemIndex,
    timestampSeconds
  }: {
    aeProjectItemIndex: number;
    timestampSeconds: number;
  }): Promise<PreviewCaptureResult> {
    const client = new HeroicSwanMcpClient({ aeMcpPath: this.aeMcpPath });
    try {
      await client.connect();
    } catch (error) {
      await client.close();
      return { ok: false, reason: `could not connect to ae-mcp: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      const result = await client.callTool("ae_capture_frame", { comp_index: aeProjectItemIndex, time: timestampSeconds });
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
