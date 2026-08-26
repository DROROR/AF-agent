import { describe, expect, it } from "vitest";
import { runBoundedProcess } from "./run-bounded-process.js";

describe("runBoundedProcess", () => {
  it("reports exit code 0 and captures real stdout/stderr on success", async () => {
    const result = await runBoundedProcess(
      "node",
      ["-e", "console.log('hello stdout'); console.error('hello stderr')"],
      5_000
    );
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain("hello stdout");
    expect(result.stderr).toContain("hello stderr");
  });

  it("reports the real non-zero exit code on failure - never fabricated", async () => {
    const result = await runBoundedProcess("node", ["-e", "process.exit(1)"], 5_000);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("reports an arbitrary non-zero/non-one exit code honestly (not coerced to 0 or 1)", async () => {
    const result = await runBoundedProcess("node", ["-e", "process.exit(2)"], 5_000);
    expect(result.exitCode).toBe(2);
  });

  it("distinguishes a real timeout (killed) from a normal exit - exitCode null, timedOut true", async () => {
    const result = await runBoundedProcess("node", ["-e", "setTimeout(() => {}, 5000)"], 200);
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(true);
  });

  it("bounds oversized stdout/stderr instead of returning them unbounded", async () => {
    const result = await runBoundedProcess(
      "node",
      ["-e", "process.stdout.write('a'.repeat(50000)); process.stderr.write('b'.repeat(50000))"],
      5_000
    );
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(10_000);
    expect(result.stderr.length).toBeLessThanOrEqual(10_000);
  });

  it("reports a null exit code (never a fabricated one) when the command cannot be spawned at all", async () => {
    const result = await runBoundedProcess("this-binary-does-not-exist-anywhere", [], 5_000);
    expect(result.exitCode).toBeNull();
  });
});
