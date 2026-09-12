import { spawn } from "node:child_process";

/**
 * Launches After Effects as a fully detached process and resolves as soon
 * as the spawn itself succeeded - never waits for AE to become usable
 * (readiness is the health probe's job - see ae-mcp-round-trip-adapter.ts).
 *
 * Detached + unref'd on purpose: AE must outlive this worker process, so a
 * later worker restart never takes the user's After Effects down with it.
 * stdio is ignored rather than piped so AE can never block on a full pipe
 * nobody is draining.
 *
 * Direct argument-array execution, never a shell string - the path comes
 * from the worker's own validated AE_PATH (DYO-Worker-Setup.ps1 confirms it
 * points at a real AfterFX.exe before ever writing it), and no caller-
 * supplied argument is ever appended.
 */
export async function launchAe(aePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(aePath, [], { detached: true, stdio: "ignore", shell: false });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}
