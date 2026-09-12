import { createReadStream, existsSync, statSync, statfsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, parse } from "node:path";
import { confineToWorkRoot } from "./confine-path.js";
import type { DiagnosticDiskRead, DiagnosticProcessRecord, DiagnosticTextRead } from "./run-diagnostic.js";

/**
 * The REAL collectors behind the diagnostic operations. Split from
 * run-diagnostic.ts so the routing/redaction/limit logic is testable without
 * a Windows machine, and so each collector's own failure mode is contained.
 */

/**
 * Streams a file and keeps only the last `maxLines` lines.
 *
 * Streaming rather than readFile is the point: worker.log grows without
 * bound between rotations, and reading a multi-hundred-megabyte file into
 * memory to show 120 lines would be a self-inflicted outage on the very
 * machine being diagnosed.
 */
export async function readTextTailFromWorkRoot(
  workRoot: string,
  relativePath: string,
  maxLines: number
): Promise<DiagnosticTextRead> {
  let absolutePath: string;
  try {
    absolutePath = confineToWorkRoot(workRoot, relativePath);
  } catch (error) {
    return { path: null, lines: [], truncated: false, note: error instanceof Error ? error.message : "path refused" };
  }

  if (!existsSync(absolutePath)) {
    // An honest absence, not an empty success - the operator needs to know
    // the difference between "no log" and "log is empty".
    return { path: absolutePath, lines: [], truncated: false, note: `file does not exist: ${absolutePath}` };
  }

  const ring: string[] = [];
  let seen = 0;
  try {
    const stream = createReadStream(absolutePath, { encoding: "utf8" });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of reader) {
      seen += 1;
      ring.push(line);
      if (ring.length > maxLines) {
        ring.shift();
      }
    }
  } catch (error) {
    return {
      path: absolutePath,
      lines: ring,
      truncated: true,
      note: `stopped reading early: ${error instanceof Error ? error.message : "read failed"}`
    };
  }

  return { path: absolutePath, lines: ring, truncated: seen > ring.length, note: null };
}

/** Injectable so the parsing can be tested against real captured `tasklist`/CIM output on any platform. */
export type ProcessSnapshotReader = () => Promise<DiagnosticProcessRecord[]>;

/**
 * Free/total space for the volumes that actually matter to this worker.
 *
 * Uses statfs rather than parsing a shell command: the 2026-09-12
 * conversion-copy work already established that a wrong free-space reading
 * silently degrades a full-package copy into an .aep-only one, so this must
 * be a real measurement, never a remembered one.
 */
export async function readDiskSpaceFor(paths: readonly string[]): Promise<DiagnosticDiskRead[]> {
  const seenRoots = new Set<string>();
  const results: DiagnosticDiskRead[] = [];

  for (const path of paths) {
    const root = parse(path).root || path;
    if (seenRoots.has(root)) {
      continue;
    }
    seenRoots.add(root);
    try {
      const stats = statfsSync(path);
      results.push({
        path: root,
        totalBytes: Number(stats.blocks) * Number(stats.bsize),
        freeBytes: Number(stats.bavail) * Number(stats.bsize),
        note: null
      });
    } catch (error) {
      results.push({
        path: root,
        totalBytes: 0,
        freeBytes: 0,
        note: `could not measure: ${error instanceof Error ? error.message : "unknown error"}`
      });
    }
  }
  return results;
}

/** Bounded so a job directory with pathological contents cannot produce an unbounded response. */
export const MAX_ARTIFACT_ENTRIES = 200;

/**
 * Describes what a job actually left on disk - names, sizes and timestamps
 * only, never file CONTENT. An artifact's bytes may be a rendered client
 * video; this operation exists to answer "did it produce anything, and how
 * big", not to exfiltrate media.
 */
export async function describeJobArtifactsUnder(
  workRoot: string,
  jobId: string
): Promise<Record<string, unknown>> {
  // jobId is schema-validated as a UUID before it reaches here, so it cannot
  // contain a separator - but it is still joined through the confinement
  // check rather than trusted, because "validated upstream" is an assumption
  // and this is the boundary that must hold on its own.
  let directory: string;
  try {
    directory = confineToWorkRoot(workRoot, join("jobs", jobId));
  } catch (error) {
    return { jobId, found: false, note: error instanceof Error ? error.message : "path refused" };
  }

  if (!existsSync(directory)) {
    return { jobId, directory, found: false, note: "no artifact directory exists for this job" };
  }

  const entries: Array<Record<string, unknown>> = [];
  let truncated = false;
  try {
    const names = await readdir(directory, { withFileTypes: true });
    for (const entry of names) {
      if (entries.length >= MAX_ARTIFACT_ENTRIES) {
        truncated = true;
        break;
      }
      const full = join(directory, entry.name);
      try {
        const info = await stat(full);
        entries.push({
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          sizeBytes: entry.isDirectory() ? null : info.size,
          modifiedAt: info.mtime.toISOString()
        });
      } catch {
        entries.push({ name: entry.name, kind: "unreadable", sizeBytes: null, modifiedAt: null });
      }
    }
  } catch (error) {
    return { jobId, directory, found: true, entries, truncated, note: error instanceof Error ? error.message : "listing failed" };
  }

  return { jobId, directory, found: true, entries, truncated, note: null };
}

/** Cheap existence/size facts about the log files themselves, for the process-tree and health views. */
export function describeLogFile(workRoot: string, relativePath: string): Record<string, unknown> {
  try {
    const path = confineToWorkRoot(workRoot, relativePath);
    if (!existsSync(path)) {
      return { path, exists: false };
    }
    const info = statSync(path);
    return { path, exists: true, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() };
  } catch (error) {
    return { path: null, exists: false, note: error instanceof Error ? error.message : "refused" };
  }
}
