import type { RenderStatus } from "../../contract/render-provider.js";

/**
 * Shotstack's real render lifecycle values. `queued`/`fetching`/`rendering`/
 * `saving`/`done`/`failed` are confirmed against Shotstack's own
 * documentation. `preprocessing` is NOT documented anywhere found in this
 * session - it was only discovered by live-polling a real sandbox render
 * (CLAUDE.md's own "recreation" POC), observed between `queued` and
 * `fetching`/`rendering` (likely asset/font pre-fetch before the render
 * proper starts). Included here because the real API returns it, not
 * because it was guessed.
 */
export const SHOTSTACK_STATUSES = [
  "queued",
  "preprocessing",
  "fetching",
  "rendering",
  "saving",
  "done",
  "failed"
] as const;
export type ShotstackStatus = (typeof SHOTSTACK_STATUSES)[number];

const STATUS_MAP: Record<ShotstackStatus, RenderStatus> = {
  queued: "QUEUED",
  preprocessing: "PROCESSING",
  fetching: "PROCESSING",
  rendering: "PROCESSING",
  saving: "PROCESSING",
  done: "DONE",
  failed: "FAILED"
};

export function mapShotstackStatus(status: ShotstackStatus): RenderStatus {
  return STATUS_MAP[status];
}
