import { spawn } from "node:child_process";
import type { Writable } from "node:stream";

export interface WorkerChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface WorkerChildHandle {
  pid: number;
  /** Resolves exactly once, when the child process itself exits. */
  exited: Promise<WorkerChildExit>;
  /** Asks the child to stop gracefully (SIGTERM - the worker's own installSignalHandlers treats this as an intentional stop). */
  requestStop: () => void;
}

export interface SpawnWorkerChildOptions {
  /** The already-installed worker's own directory - same as run-worker.bat's cwd today. */
  installDir: string;
  /** Appended to verbatim - the exact same file run-worker.bat/the supervisor launcher writes to, so existing log-tailing/verification (DYO-Worker-Final-Update.ps1) keeps working unchanged. */
  logStream: Writable;
  /** Injected only for tests - real callers omit this and get process.execPath. */
  execPath?: string;
}

/**
 * Spawns the exact same worker invocation run-worker.bat always has -
 * `node --env-file=.env dist/index.js` from installDir - so
 * DYO-Worker-Final-Update.ps1's existing Test-IsDyoWorkerCommandLine
 * process-matching regex keeps matching it unchanged; only the TOP-LEVEL
 * process Task Scheduler launches changes (this supervisor, not cmd.exe
 * directly). `shell: false` (never a cmd.exe host for this child - no
 * shared console to propagate a stray console-control event) and
 * `windowsHide: true` (a real, documented Node.js child_process option:
 * never allocates a console window for this child on Windows at all) -
 * together these are the actual fix for "closing a visible console
 * window can kill production": there is no window to close anymore.
 */
export function spawnWorkerChild(options: SpawnWorkerChildOptions): WorkerChildHandle {
  const execPath = options.execPath ?? process.execPath;
  const child = spawn(execPath, ["--env-file=.env", "dist/index.js"], {
    cwd: options.installDir,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.pipe(options.logStream, { end: false });
  child.stderr?.pipe(options.logStream, { end: false });

  const exited = new Promise<WorkerChildExit>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  if (child.pid === undefined) {
    // Node guarantees `pid` is set once spawn() returns without throwing
    // synchronously - this branch only exists so the type system doesn't
    // need `pid: number | undefined` propagated through every caller.
    throw new Error("worker child process has no pid immediately after spawn");
  }

  return {
    pid: child.pid,
    exited,
    requestStop: () => {
      child.kill("SIGTERM");
    }
  };
}
