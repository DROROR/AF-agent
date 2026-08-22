import type { RenderStatus } from "../../contract/render-provider.js";

/**
 * Shotstack's real render lifecycle values, confirmed against Shotstack's
 * own documentation (queued -> fetching -> rendering -> saving -> done, with
 * failed as the terminal error state) - not guessed.
 */
export const SHOTSTACK_STATUSES = ["queued", "fetching", "rendering", "saving", "done", "failed"] as const;
export type ShotstackStatus = (typeof SHOTSTACK_STATUSES)[number];

const STATUS_MAP: Record<ShotstackStatus, RenderStatus> = {
  queued: "QUEUED",
  fetching: "PROCESSING",
  rendering: "PROCESSING",
  saving: "PROCESSING",
  done: "DONE",
  failed: "FAILED"
};

export function mapShotstackStatus(status: ShotstackStatus): RenderStatus {
  return STATUS_MAP[status];
}
