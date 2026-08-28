export interface ProcessSafetyNetLogger {
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ProcessSafetyNetDeps {
  logger: ProcessSafetyNetLogger;
  /** Injected only so tests never actually terminate the test process. */
  exit: (code: number) => void;
  process: {
    on: (event: "uncaughtException" | "unhandledRejection", listener: (error: unknown) => void) => void;
  };
}

/**
 * Last-resort top-level guard. Every currently-known async call site in
 * this worker (heartbeat-loop.ts's tick(), job-cycle.ts's runJobCycle())
 * already catches its own errors and never rejects - see each file's own
 * doc comment, including job-cycle.ts's account of the exact bug this
 * class of gap caused before it was fixed there. This exists purely as
 * defense-in-depth against a FUTURE or overlooked call site doing the same
 * thing: a synchronous throw or an unhandled promise rejection anywhere in
 * the process would otherwise crash Node with an unformatted dump (and,
 * before Node 15, could silently do nothing at all) instead of one clean,
 * structured, sanitized log line - and Task Scheduler's own
 * RestartCount/RestartInterval (DYO-Worker-Setup.ps1) only ever restarts a
 * process that has actually exited, so a hang or a swallowed rejection
 * would never trigger it. Always exits after logging - a process that hit
 * a truly unhandled error is in an unknown state, and restarting fresh
 * (via the Scheduled Task) is safer than trying to keep running it.
 */
export function installProcessSafetyNet(deps: ProcessSafetyNetDeps): void {
  const handle = (kind: "uncaughtException" | "unhandledRejection") => (error: unknown): void => {
    deps.logger.error(
      `NEEDS_ATTENTION: worker process hit an unhandled ${kind === "uncaughtException" ? "exception" : "promise rejection"} and is exiting - the Scheduled Task will restart it automatically`,
      { error: error instanceof Error ? error.message : String(error) }
    );
    deps.exit(1);
  };
  deps.process.on("uncaughtException", handle("uncaughtException"));
  deps.process.on("unhandledRejection", handle("unhandledRejection"));
}
