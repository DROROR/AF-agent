import path from "node:path";
import { safeJoin } from "../workspace/work-root.js";

/**
 * Relative to workRoot, same convention as worker-credentials.json
 * (state/worker-credentials.json) - a durable, simple, file-existence
 * signal the updater/repair/uninstall scripts set BEFORE stopping the
 * worker and clear only once maintenance is fully done. This is the
 * single authoritative "is it safe to restart the worker child right
 * now" check the supervisor consults before every restart attempt -
 * deliberately independent of exactly HOW Windows/Task Scheduler ends
 * the process, so it works correctly regardless of the precise stop
 * mechanism (see docs on the real 0xC000013A root cause this supervisor
 * exists to fix).
 */
export const MAINTENANCE_FLAG_RELATIVE_PATH = path.join("state", "maintenance.flag");

export function maintenanceFlagPath(workRoot: string): string {
  return safeJoin(workRoot, "state", "maintenance.flag");
}

export interface MaintenanceFlagDeps {
  existsSync: (path: string) => boolean;
}

/** Pure, injectable check - real callers pass node:fs's existsSync; tests pass a fake. */
export function isMaintenanceActive(deps: MaintenanceFlagDeps, workRoot: string): boolean {
  return deps.existsSync(maintenanceFlagPath(workRoot));
}
