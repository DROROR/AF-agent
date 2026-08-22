import type { HeartbeatLoop } from "./heartbeat-loop.js";

export interface ShutdownLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Stops the heartbeat loop cleanly and waits for any in-flight tick to
 * settle before returning, so the process never exits mid-request and local
 * state (e.g. a just-written credentials file) is left consistent.
 */
export async function shutdownGracefully(loop: HeartbeatLoop, logger: ShutdownLogger): Promise<void> {
  logger.info("Shutting down: stopping heartbeat loop");
  loop.stop();
  await loop.waitForIdle();
  logger.info("Shutdown complete");
}
