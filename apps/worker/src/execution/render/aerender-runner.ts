import { spawn } from "node:child_process";
import { buildAerenderArgs, type AerenderArgsParams } from "./aerender-args.js";

/** A pathological renderer's own stdout/stderr must never be able to exhaust worker memory - bounded independently per stream (render-engine phase section 4/16). */
const MAX_CAPTURED_LOG_CHARS = 200_000;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour - a real render can legitimately run long; this only guards against a truly hung process.
/** Grace period after SIGTERM before escalating to SIGKILL on timeout/cancel - never an immediate SIGKILL, which can leave AE in a worse state. */
const KILL_GRACE_MS = 5_000;

export interface AerenderRunParams extends AerenderArgsParams {
  executablePath: string;
  timeoutMs?: number;
}

export interface AerenderRunResult {
  /** True only if the process was actually spawned and ran to a real exit (successfully or not) - false if it could not even be started (see spawnError). This is NOT "the render succeeded" - callers check exitCode/timedOut separately, never infer success from `ok` alone. */
  ok: boolean;
  pid: number | null;
  exitCode: number | null;
  /** Set when the process signal-terminated (e.g. after a timeout kill) rather than exiting normally - exitCode is then typically null. */
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  startedAt: string;
  completedAt: string;
  /** Bounded, truncated-if-needed capture - never the full unbounded stream. */
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** Set only when the process could never be spawned at all (e.g. ENOENT) - ok is false in that case. */
  spawnError: string | null;
}

class BoundedLogBuffer {
  private text = "";
  private truncated = false;

  append(chunk: string): void {
    if (this.truncated) {
      return;
    }
    const remaining = MAX_CAPTURED_LOG_CHARS - this.text.length;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    if (chunk.length > remaining) {
      this.text += chunk.slice(0, remaining);
      this.truncated = true;
    } else {
      this.text += chunk;
    }
  }

  value(): { text: string; truncated: boolean } {
    return { text: this.text, truncated: this.truncated };
  }
}

export interface AerenderRunner {
  run(params: AerenderRunParams): Promise<AerenderRunResult>;
}

/**
 * Direct, argument-array process execution - NEVER a shell string (render-
 * engine phase section 4: "spawn(executable, args, {shell:false})... no
 * shell interpolation"). `spawn` here is always called with an explicit
 * executable path and a fixed, allowlisted argument array built only by
 * buildAerenderArgs - there is no code path in this class that could ever
 * construct or execute an arbitrary command string.
 */
export class RealAerenderRunner implements AerenderRunner {
  async run(params: AerenderRunParams): Promise<AerenderRunResult> {
    const args = buildAerenderArgs(params);
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date();

    return new Promise<AerenderRunResult>((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(params.executablePath, args, { shell: false });
      } catch (error) {
        resolve({
          ok: false,
          pid: null,
          exitCode: null,
          signal: null,
          timedOut: false,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
          spawnError: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      const stdout = new BoundedLogBuffer();
      const stderr = new BoundedLogBuffer();
      let timedOut = false;
      let settled = false;
      let killGraceTimer: NodeJS.Timeout | null = null;

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        // SIGTERM first, then escalate to SIGKILL after a grace period -
        // never an immediate SIGKILL (render-engine phase section 4).
        child.kill("SIGTERM");
        killGraceTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, KILL_GRACE_MS);
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk.toString("utf8")));

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutTimer);
        if (killGraceTimer) {
          clearTimeout(killGraceTimer);
        }
        const stdoutValue = stdout.value();
        const stderrValue = stderr.value();
        resolve({
          ok: false,
          pid: child.pid ?? null,
          exitCode: null,
          signal: null,
          timedOut,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
          stdout: stdoutValue.text,
          stderr: stderrValue.text,
          stdoutTruncated: stdoutValue.truncated,
          stderrTruncated: stderrValue.truncated,
          spawnError: error.message
        });
      });

      // "close" (not "exit") - exit can fire before this worker has finished
      // draining stdout/stderr, since Node does not guarantee stdio stream
      // completion is ordered before the exit event; close fires only once
      // the streams have themselves ended, so capture here is complete.
      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutTimer);
        if (killGraceTimer) {
          clearTimeout(killGraceTimer);
        }
        const stdoutValue = stdout.value();
        const stderrValue = stderr.value();
        resolve({
          ok: true,
          pid: child.pid ?? null,
          exitCode: code,
          signal,
          timedOut,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
          stdout: stdoutValue.text,
          stderr: stderrValue.text,
          stdoutTruncated: stdoutValue.truncated,
          stderrTruncated: stderrValue.truncated,
          spawnError: null
        });
      });
    });
  }
}

export class AerenderTransportUnavailableError extends Error {
  constructor(reason?: string) {
    super(reason ?? "RENDER cannot run: no real aerender executable is configured (AERENDER_PATH is unset or not found).");
    this.name = "AerenderTransportUnavailableError";
  }
}

/** Honest stub - never fabricates a render result. Mirrors NotAvailableAeEditBridge's own contract. */
export class NotAvailableAerenderRunner implements AerenderRunner {
  async run(_params: AerenderRunParams): Promise<AerenderRunResult> {
    throw new AerenderTransportUnavailableError();
  }
}
