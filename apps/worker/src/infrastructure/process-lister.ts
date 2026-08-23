import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROCESS_CHECK_TIMEOUT_MS = 5_000;

export type ProcessRunningStatus = "RUNNING" | "NOT_RUNNING" | "UNKNOWN";

export interface ProcessLister {
  isImageRunning(imageName: string): Promise<ProcessRunningStatus>;
}

/**
 * Reliable process-running check on Windows via a single fixed, allowlisted
 * command (`tasklist`) with fixed arguments - never a caller-supplied
 * command/shell string (docs/engineering/SECURITY.md, ERROR_HANDLING.md
 * "every spawned process must define: allowlisted command, timeout, ...").
 * Any failure to run tasklist itself is UNKNOWN, never fabricated as
 * ONLINE/OFFLINE.
 */
class WindowsTasklistProcessLister implements ProcessLister {
  async isImageRunning(imageName: string): Promise<ProcessRunningStatus> {
    try {
      const { stdout } = await execFileAsync(
        "tasklist",
        ["/FI", `IMAGENAME eq ${imageName}`, "/NH"],
        { timeout: PROCESS_CHECK_TIMEOUT_MS }
      );
      return stdout.toLowerCase().includes(imageName.toLowerCase()) ? "RUNNING" : "NOT_RUNNING";
    } catch {
      return "UNKNOWN";
    }
  }
}

/** Used on platforms where we have no reliable way to check (anything but Windows). */
class UnsupportedProcessLister implements ProcessLister {
  async isImageRunning(): Promise<ProcessRunningStatus> {
    return "UNKNOWN";
  }
}

export function createProcessLister(platform: NodeJS.Platform = process.platform): ProcessLister {
  return platform === "win32" ? new WindowsTasklistProcessLister() : new UnsupportedProcessLister();
}
