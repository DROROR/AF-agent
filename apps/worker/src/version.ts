import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkerBuildInfo {
  /** Full git commit SHA the running build was packaged from. */
  commit: string;
  /** ISO timestamp of when scripts/package-windows-worker.mjs produced this build. */
  builtAt: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * Reads the harmless build/version marker (BUILD_INFO.json) written
 * alongside this compiled worker by scripts/package-windows-worker.mjs -
 * lets server/client logs prove exactly which worker build produced a
 * given heartbeat/job, without exposing anything sensitive (just a commit
 * SHA and a build timestamp - never a secret, never a credential).
 *
 * Returns null (never fabricates a value) when the marker is absent - the
 * normal case in local dev, where this file is only ever produced by the
 * packaging script for a real Windows Worker distribution.
 */
export function readWorkerBuildInfo(baseDir: string = join(currentDir, "..")): WorkerBuildInfo | null {
  try {
    const raw = readFileSync(join(baseDir, "BUILD_INFO.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkerBuildInfo>;
    if (typeof parsed.commit === "string" && typeof parsed.builtAt === "string") {
      return { commit: parsed.commit, builtAt: parsed.builtAt };
    }
    return null;
  } catch {
    return null;
  }
}
