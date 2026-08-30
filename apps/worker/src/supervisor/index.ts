import { existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { defaultWorkRoot } from "../env.js";
import { resolveWorkRoot } from "../workspace/work-root.js";
import { readWorkerBuildInfo } from "../version.js";
import { isMaintenanceActive } from "./maintenance-flag.js";
import { spawnWorkerChild } from "./spawn-worker-child.js";
import { createSupervisorLoop } from "./supervisor-loop.js";

/**
 * The real Windows entrypoint the Scheduled Task now launches (via a small
 * hidden powershell.exe launcher - see scripts/windows-worker-supervisor-
 * launcher.ps1, which also owns the once-per-launch worker.log rotation,
 * exactly mirroring run-worker.bat's own previous behavior) INSTEAD OF
 * running the worker directly. Its whole purpose: a real, unhandled
 * Windows console-control-event (Ctrl+Break, the console window being
 * closed, or the interactive session ending) used to kill the worker's
 * own node.exe with no graceful shutdown and no restart, because Task
 * Scheduler's RestartCount/RestartInterval policy does not reliably
 * cover that class of termination (real production incident, 2026-08-30,
 * NTSTATUS 0xC000013A). This process:
 *   - spawns the SAME worker invocation run-worker.bat always used
 *     (`node --env-file=.env dist/index.js` from InstallDir) as a child
 *     with windowsHide:true - no console window ever exists for it, so
 *     there is nothing for anyone to close.
 *   - restarts that child automatically after any ordinary/unexpected
 *     exit, with a short bounded backoff (supervisor-loop.ts).
 *   - never restarts while state/maintenance.flag exists (the updater/
 *     repair/uninstall's own explicit signal - maintenance-flag.ts).
 *   - never touches the worker's own registration/credentials/config.
 *   - never touches an AE project.
 * Task Scheduler's own RestartCount/RestartInterval remains the OUTER
 * safety net, now protecting THIS supervisor process itself rather than
 * the worker directly - if this process somehow dies, Task Scheduler
 * still restarts it within about a minute, same as before.
 */

const logger = pino({ level: "info" });

async function main(): Promise<void> {
  const installDir = process.cwd();
  const workRoot = resolveWorkRoot(process.env.WORK_ROOT ?? defaultWorkRoot());
  const buildInfo = readWorkerBuildInfo();
  const logPath = path.join(installDir, "logs", "worker.log");

  // The launcher (.ps1) already rotated any previous run's log before
  // starting this process - this only ensures the directory/file exist,
  // it never rotates itself, so there is exactly one place that decision
  // is made.
  await mkdir(path.dirname(logPath), { recursive: true });
  const logFileHandle = await open(logPath, "a");
  const logStream = logFileHandle.createWriteStream();

  logger.info({ installDir, workRoot, buildInfo }, "supervisor starting");

  const loop = createSupervisorLoop({
    spawnChild: () => spawnWorkerChild({ installDir, logStream }),
    isMaintenanceActive: () => isMaintenanceActive({ existsSync }, workRoot),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logger,
    buildInfo
  });

  let stopping = false;
  const handleStopSignal = (signal: NodeJS.Signals): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info({ signal }, "supervisor received a stop signal - asking the current worker child to stop, will not restart");
    loop.stop();
  };
  process.once("SIGINT", handleStopSignal);
  process.once("SIGTERM", handleStopSignal);

  await loop.run();
  logStream.end();
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Supervisor failed to start", error);
  process.exit(1);
});
