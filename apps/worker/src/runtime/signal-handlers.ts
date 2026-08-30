export type ObservedSignal = "SIGINT" | "SIGTERM" | "SIGBREAK" | "SIGHUP";

export interface SignalHandlerLogger {
  info: (meta: Record<string, unknown>, message: string) => void;
  error: (meta: Record<string, unknown>, message: string) => void;
}

export interface InstallSignalHandlersDeps {
  logger: SignalHandlerLogger;
  shutdownGracefully: () => Promise<void>;
  exit: (code: number) => void;
  /** Injected so tests never register a real process-wide signal listener. */
  on: (event: ObservedSignal, listener: () => void) => void;
}

/**
 * Exit code used for SIGBREAK/SIGHUP - deliberately nonzero and distinct
 * from both a clean intentional stop (0) and an internal crash
 * (process-safety-net.ts's own exit(1)), so worker.log/a supervisor can
 * always tell these three apart.
 */
export const EXTERNAL_INTERRUPTION_EXIT_CODE = 2;

/**
 * SIGINT/SIGTERM are how a controlled actor asks this process to stop - a
 * human at a real console (Ctrl+C), or the supervised runtime's own
 * supervisor process (supervisor/index.ts) sending SIGTERM to ask this
 * worker to end for a maintenance-driven stop. These exit 0: a clean,
 * expected stop.
 *
 * SIGBREAK/SIGHUP are what Windows delivers when something OUTSIDE this
 * process's own control ends it: Ctrl+Break (SIGBREAK), or the console
 * window being closed (SIGHUP - Windows' CTRL_CLOSE_EVENT, which Node/
 * libuv surfaces as SIGHUP). Real production evidence (2026-08-30): a
 * worker exited with NTSTATUS 0xC000013A (STATUS_CONTROL_C_EXIT) - the
 * OS's default, UNHANDLED console-control-event termination - after
 * previously registering no handler for either signal, so the OS's
 * default action killed it with no graceful shutdown and no distinguishing
 * log line. These still run the exact same graceful shutdown steps (if
 * there is time before Windows force-kills), but exit with
 * EXTERNAL_INTERRUPTION_EXIT_CODE and a clearly different log message, so
 * this is never confused with an intentional stop. This worker never
 * assumes Task Scheduler will restart it for these - the supervised
 * runtime's own supervisor process (supervisor/index.ts) is the real
 * recovery mechanism; this is observability, not a recovery strategy.
 *
 * Windows also delivers CTRL_LOGOFF_EVENT/CTRL_SHUTDOWN_EVENT to a
 * console process group on session logoff/machine shutdown - but Node.js
 * on Windows never surfaces either of those as a JS signal event at all
 * (only SIGINT/SIGBREAK/SIGHUP are ever emitted). There is deliberately no
 * handler for them here, because one could never fire - claiming
 * otherwise would be dishonest. Recovery from an actual logoff is the
 * AtLogOn Scheduled Task trigger starting a fresh supervisor at the next
 * real logon, never a claim that this process detected or survived the
 * logoff itself.
 */
export function installSignalHandlers(deps: InstallSignalHandlersDeps): void {
  let shuttingDown = false;

  const handle = (signal: ObservedSignal, exitCode: number, logMessage: string) => (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    deps.logger.info({ signal }, logMessage);
    void deps.shutdownGracefully().then(
      () => deps.exit(exitCode),
      (error: unknown) => {
        deps.logger.error(
          { error: error instanceof Error ? error.message : String(error), signal },
          "error during shutdown"
        );
        deps.exit(1);
      }
    );
  };

  deps.on("SIGINT", handle("SIGINT", 0, "received shutdown signal"));
  deps.on("SIGTERM", handle("SIGTERM", 0, "received shutdown signal"));
  deps.on(
    "SIGBREAK",
    handle(
      "SIGBREAK",
      EXTERNAL_INTERRUPTION_EXIT_CODE,
      "received an external interruption signal (Ctrl+Break) - this was not a requested stop"
    )
  );
  deps.on(
    "SIGHUP",
    handle(
      "SIGHUP",
      EXTERNAL_INTERRUPTION_EXIT_CODE,
      "received an external interruption signal (console closed) - this was not a requested stop"
    )
  );
}
