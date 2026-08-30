import { spawn } from "node:child_process";
import path from "node:path";
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
 * Spawns the worker with the SAME real invocation run-worker.bat always
 * had - `node --env-file=.env dist\index.js` from installDir - only the
 * TOP-LEVEL process Task Scheduler launches changes (this supervisor, not
 * cmd.exe directly). `shell: false` (never a cmd.exe host for this child -
 * no shared console to propagate a stray console-control event) and
 * `windowsHide: true` (a real, documented Node.js child_process option:
 * never allocates a console window for this child on Windows at all) -
 * together these are the actual fix for "closing a visible console
 * window can kill production": there is no window to close anymore.
 *
 * CONFIRMED BUG (real client machine, 2026-08-30): an earlier version of
 * this function passed a hand-written RELATIVE "dist/index.js" (forward
 * slash, the natural cross-platform way to write it as a string literal)
 * as the script argument. The worker itself started and heartbeated
 * completely normally - Node resolves forward-slash paths fine on
 * Windows - but DYO-Worker-Final-Update.ps1/DYO-Worker-Lifecycle-
 * SelfTest.ps1's own PowerShell process-matching regex required a
 * literal BACKSLASH (`dist\index.js`, matching run-worker.bat's old
 * native-Windows-syntax invocation) and so never matched the real,
 * healthy, heartbeating worker's actual command line at all - a pure
 * process-DETECTION false negative, not a startup failure (the dashboard
 * showed the worker ONLINE with fresh heartbeats the whole time). Fixed
 * with path.join("dist", "index.js") - resolves to genuine
 * backslash-separated Windows syntax on win32 (matching run-worker.bat
 * exactly, byte for byte), never a hand-written separator that can
 * silently diverge again. Deliberately kept RELATIVE (not installDir-
 * prefixed) - DYO-Worker-CheckHealth-Update.ps1 has its own CONFIRMED BUG
 * note from an earlier incident: run-worker.bat's invocation is always
 * relative (`cd /d "%~dp0"` then a bare relative script path), so an
 * install-directory-anchored matcher can never find it in the real
 * CommandLine at all - anchoring to installDir here would silently
 * resurrect that exact class of bug.
 */
/**
 * The exact argv this worker is spawned with (after execPath) - pulled out
 * as its own pure, directly-testable function because the spawned
 * child's OWN `process.argv` cannot be used to verify this: Node always
 * resolves `process.argv[1]` to an absolute path internally regardless of
 * what was passed on the command line, so a black-box test from inside
 * the child can never observe the literal string this module actually
 * passed to spawn() - exactly the layer the real 2026-08-30 bug lived at.
 */
export function buildWorkerChildArgs(): string[] {
  return ["--env-file=.env", path.join("dist", "index.js")];
}

export function spawnWorkerChild(options: SpawnWorkerChildOptions): WorkerChildHandle {
  const execPath = options.execPath ?? process.execPath;
  const child = spawn(execPath, buildWorkerChildArgs(), {
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
