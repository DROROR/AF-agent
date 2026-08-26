import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

export interface SourceProjectHash {
  path: string;
  name: string;
  sha256: string;
}

export type HashSourceProjectResult = { ok: true; value: SourceProjectHash } | { ok: false; reason: string };

/**
 * Hashes the real .aep file at `path` on the worker's own filesystem -
 * CLAUDE.md Safety Rule 8 ("hash source .aep files before processing and
 * verify originals remain unchanged"). Deliberately independent of
 * whatever ae-mcp's ae_get_project_info reports for the currently open AE
 * project (which can be "Untitled"/null if the document hasn't been saved
 * under a real name yet, or simply doesn't expose a path) - this is the
 * one place a real, human-supplied file path (INSPECT_TEMPLATE's own
 * sourceProjectPath request field) gets verified to actually exist on
 * disk and hashed, never assumed or substituted with AE's self-report.
 */
export async function hashSourceProject(path: string): Promise<HashSourceProjectResult> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      return { ok: false, reason: `${path} is not a regular file` };
    }
  } catch (error) {
    return {
      ok: false,
      reason: `cannot access ${path}: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const name = basename(path);
  if (name.length === 0) {
    return { ok: false, reason: `${path} has no file name component` };
  }

  return new Promise((resolve) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", (error) => resolve({ ok: false, reason: `failed reading ${path}: ${error.message}` }));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve({ ok: true, value: { path, name, sha256: hash.digest("hex") } }));
  });
}
