import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROCESS_CHECK_TIMEOUT_MS = 8_000;
/**
 * How long a DEFINITE observation may stand in for an inconclusive one.
 *
 * REAL 2026-09-12 INCIDENT: on the QA machine aeStatus flapped
 * ONLINE -> UNKNOWN -> ONLINE between heartbeats, because `tasklist` on a
 * loaded machine intermittently exceeded its (then 5s) timeout. Every
 * dispatch precondition requires AE ONLINE, so an intermittently
 * inconclusive check intermittently blocked all work on a machine where AE
 * was running the whole time.
 *
 * This never invents a status: it only re-reports a REAL, RECENT observation
 * when a fresh check could not conclude, and only for this short window.
 * Once the window passes, UNKNOWN is reported honestly rather than
 * pretending the last answer still holds.
 */
const DEFINITE_RESULT_REUSE_MS = 60_000;

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
/** The one real tasklist invocation - injectable ONLY so tests can exercise the retry/reuse behaviour without spawning real processes. */
export type TasklistRunner = (imageName: string) => Promise<ProcessRunningStatus>;

const realTasklistRunner: TasklistRunner = async (imageName) => {
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
};

/**
 * Hard wall-clock ceiling for ONE attempt, independent of execFile's own
 * `timeout`.
 *
 * REAL 2026-09-12 REGRESSION: raising execFile's timeout and adding a retry
 * made a HANGING tasklist block the heartbeat path for far longer - the
 * worker heartbeated once and then went silent. execFile's timeout kills the
 * child, but that is not a guarantee the promise settles promptly on this
 * machine. The earlier 5s timeout was, accidentally, the only thing keeping
 * heartbeats flowing: fast UNKNOWNs. The lesson is that the heartbeat must
 * never await an external probe without its own ceiling.
 */
const ATTEMPT_DEADLINE_MS = 2_500;

export class WindowsTasklistProcessLister implements ProcessLister {
  private readonly lastDefinite = new Map<string, { status: ProcessRunningStatus; at: number }>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly runOnce: TasklistRunner = realTasklistRunner
  ) {}

  /** Races one attempt against a hard deadline, so a hung tasklist costs at most ATTEMPT_DEADLINE_MS rather than stalling the heartbeat. */
  private async runBounded(imageName: string): Promise<ProcessRunningStatus> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.runOnce(imageName),
        new Promise<ProcessRunningStatus>((resolve) => {
          timer = setTimeout(() => resolve("UNKNOWN"), ATTEMPT_DEADLINE_MS);
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async isImageRunning(imageName: string): Promise<ProcessRunningStatus> {
    let status = await this.runBounded(imageName);
    if (status === "UNKNOWN") {
      // One bounded retry - a single slow tasklist should not decide this.
      // Worst case for the whole call is therefore 2 x ATTEMPT_DEADLINE_MS,
      // comfortably inside the heartbeat interval.
      status = await this.runBounded(imageName);
    }
    if (status !== "UNKNOWN") {
      this.lastDefinite.set(imageName, { status, at: this.now() });
      return status;
    }
    const previous = this.lastDefinite.get(imageName);
    if (previous && this.now() - previous.at < DEFINITE_RESULT_REUSE_MS) {
      return previous.status;
    }
    return "UNKNOWN";
  }
}

/** Used on platforms where we have no reliable way to check (anything but Windows). */
class UnsupportedProcessLister implements ProcessLister {
  async isImageRunning(): Promise<ProcessRunningStatus> {
    return "UNKNOWN";
  }
}

export function createProcessLister(platform: NodeJS.Platform = process.platform, now: () => number = () => Date.now()): ProcessLister {
  return platform === "win32" ? new WindowsTasklistProcessLister(now) : new UnsupportedProcessLister();
}
