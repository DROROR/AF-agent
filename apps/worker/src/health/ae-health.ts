import { existsSync } from "node:fs";
import type { AeStatus } from "@dyo/schemas";
import type { ProcessLister } from "../infrastructure/process-lister.js";

const AFTERFX_IMAGE_NAME = "AfterFX.exe";
const VERSION_IN_PATH_PATTERN = /20\d{2}/;

export interface AeHealthConfig {
  aePath: string | undefined;
  aerenderPath: string | undefined;
}

export interface AeHealthResult {
  aeStatus: AeStatus;
  aeVersion: string | null;
  aerenderAvailable: boolean;
}

/** Best-effort version extraction from the configured install path, e.g. ".../Adobe After Effects 2026/". Never fabricated - null if nothing recognizable is present. */
function extractVersionHint(aePath: string): string | null {
  const match = VERSION_IN_PATH_PATTERN.exec(aePath);
  return match ? match[0] : null;
}

/**
 * Read-only local health detection - never writes to disk, never modifies AE
 * state. Only reports ONLINE/OFFLINE when the running-process check actually
 * ran; anything it cannot reliably determine is UNKNOWN, per Phase 2's "do
 * not fabricate" requirement (mirrored for MCP in mcp-adapter.ts).
 */
export async function detectAeHealth(
  config: AeHealthConfig,
  processLister: ProcessLister
): Promise<AeHealthResult> {
  const aeVersion = config.aePath ? extractVersionHint(config.aePath) : null;
  const aerenderAvailable = Boolean(config.aerenderPath) && existsSync(config.aerenderPath as string);

  if (!config.aePath) {
    return { aeStatus: "UNKNOWN", aeVersion, aerenderAvailable };
  }

  const runningStatus = await processLister.isImageRunning(AFTERFX_IMAGE_NAME);
  const aeStatus: AeStatus =
    runningStatus === "RUNNING" ? "ONLINE" : runningStatus === "NOT_RUNNING" ? "OFFLINE" : "UNKNOWN";

  return { aeStatus, aeVersion, aerenderAvailable };
}
