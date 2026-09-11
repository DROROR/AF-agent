import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeDiagnosticFrameRange } from "../element3d-ab-test-cli.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(currentDir, "..", "element3d-ab-test-cli.ts");

describe("computeDiagnosticFrameRange", () => {
  it("computes the frame range for comp-1600's local 2.4s-2.8s window at 29.97fps", () => {
    const result = computeDiagnosticFrameRange(7.007007, 29.97, 2.4, 2.8);
    expect(result.startFrame).toBe(Math.round(2.4 * 29.97));
    expect(result.endFrame).toBe(Math.round(2.8 * 29.97));
    expect(result.startFrame).toBeLessThan(result.endFrame);
  });

  it("clamps endFrame to the composition's own last real frame, never past it", () => {
    const result = computeDiagnosticFrameRange(2.5, 30, 2.4, 2.8);
    // durationSeconds=2.5s @ 30fps = 75 frames total, last real frame index 74
    expect(result.endFrame).toBe(74);
  });

  it("clamps startFrame to 0, never negative", () => {
    const result = computeDiagnosticFrameRange(5, 30, -1, 2.8);
    expect(result.startFrame).toBe(0);
  });
});

describe("direct-execution entry point (real 2026-09-11 bug: exited 0 with zero output on Windows)", () => {
  it("actually invokes main() when run as the entry script, reaching the expected AE_MCP_PATH failure rather than silently exiting 0", () => {
    let threw = false;
    let stderr = "";
    const childEnv: NodeJS.ProcessEnv = { ...process.env, DYO_API_URL: "https://example.invalid", WORKER_NAME: "test-worker" };
    delete childEnv.AE_MCP_PATH;
    delete childEnv.AERENDER_PATH;
    try {
      execFileSync("npx", ["tsx", cliPath], {
        env: childEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      threw = true;
      stderr = (error as { stderr?: string }).stderr ?? "";
    }
    // The old bug: main() never ran at all, so the process exited 0 with no
    // output whatsoever - `threw` would be false and stderr would be empty.
    expect(threw).toBe(true);
    expect(stderr).toContain("AE_MCP_PATH is not configured");
  }, 30_000);
});
