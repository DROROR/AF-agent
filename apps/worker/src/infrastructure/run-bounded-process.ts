import { execFile } from "node:child_process";

export interface BoundedProcessResult {
  /** The real process exit code, or null when it never produced one (spawn failure, or killed for exceeding timeoutMs). */
  exitCode: number | null;
  /** True only when the process was killed for exceeding timeoutMs - distinct from any other non-zero/failed exit. */
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

/** What actually gets stored/returned - deliberately small (real ae-mcp health output is a handful of short lines). */
const MAX_OUTPUT_CHARS = 10_000;
/**
 * Node's own hard stream-buffer ceiling - independent of, and much larger
 * than, MAX_OUTPUT_CHARS. This exists only to stop a truly pathological/
 * runaway process from consuming unbounded memory; ordinary output up to
 * this size is captured in full and THEN truncated to MAX_OUTPUT_CHARS by
 * `bound()` below. If these two constants were close together, Node could
 * kill the process for exceeding maxBuffer before bound() ever saw a
 * clean, complete capture to truncate - each stream is measured against
 * maxBuffer independently, so a bare 4x margin was not enough headroom.
 */
const MAX_BUFFER_BYTES = 5_000_000;

// Node's typings claim stdout/stderr are always `string` here, but real
// behavior (confirmed empirically) can hand back `null` for a stream that
// individually exceeded maxBuffer while the other did not - guarded
// defensively rather than trusting the type.
function bound(text: string | null): { text: string; truncated: boolean } {
  const safe = text ?? "";
  if (safe.length <= MAX_OUTPUT_CHARS) {
    return { text: safe, truncated: false };
  }
  return { text: safe.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

/**
 * Runs one fixed, allowlisted command - never a shell string, never
 * arguments influenced by API/operator input beyond what the caller
 * itself hardcodes - and captures its exit code plus bounded
 * stdout/stderr. Distinguishes a real timeout (the process was killed for
 * exceeding `timeoutMs`, confirmed via Node's own `error.killed`/
 * `error.code === null` combination - verified empirically, not assumed)
 * from any other non-zero/failed exit, which a bare exit-code check alone
 * cannot do.
 */
export function runBoundedProcess(command: string, args: readonly string[], timeoutMs: number): Promise<BoundedProcessResult> {
  return new Promise((resolve) => {
    execFile(command, args as string[], { timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
      const out = bound(stdout);
      const err = bound(stderr);
      if (!error) {
        resolve({
          exitCode: 0,
          timedOut: false,
          stdout: out.text,
          stderr: err.text,
          stdoutTruncated: out.truncated,
          stderrTruncated: err.truncated
        });
        return;
      }
      resolve({
        exitCode: typeof error.code === "number" ? error.code : null,
        timedOut: Boolean(error.killed),
        stdout: out.text,
        stderr: err.text,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated
      });
    });
  });
}
