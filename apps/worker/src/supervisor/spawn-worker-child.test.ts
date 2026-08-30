import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorkerChildArgs, spawnWorkerChild } from "./spawn-worker-child.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-spawn-worker-child-"));
  await writeFile(join(dir, ".env"), "");
  await mkdir(join(dir, "dist"), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function collectingStream(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
  });
  return { stream, text: () => buffer };
}

describe("spawnWorkerChild", () => {
  it("spawns a real child process, reports its real pid, and resolves `exited` with its real exit code", async () => {
    await writeFile(join(dir, "dist", "index.js"), "process.exit(0);\n");
    const { stream, text } = collectingStream();

    const handle = spawnWorkerChild({ installDir: dir, logStream: stream });

    expect(handle.pid).toBeGreaterThan(0);
    const exit = await handle.exited;
    expect(exit).toEqual({ code: 0, signal: null });
    expect(text()).toBe("");
  });

  it("pipes the child's real stdout AND stderr into the provided log stream, verbatim", async () => {
    await writeFile(
      join(dir, "dist", "index.js"),
      "process.stdout.write('hello from stdout\\n'); process.stderr.write('hello from stderr\\n'); process.exit(0);\n"
    );
    const { stream, text } = collectingStream();

    const handle = spawnWorkerChild({ installDir: dir, logStream: stream });
    await handle.exited;
    await new Promise((resolve) => setImmediate(resolve));

    expect(text()).toContain("hello from stdout");
    expect(text()).toContain("hello from stderr");
  });

  it("reports a real nonzero exit code when the child exits with one", async () => {
    await writeFile(join(dir, "dist", "index.js"), "process.exit(7);\n");
    const { stream } = collectingStream();

    const handle = spawnWorkerChild({ installDir: dir, logStream: stream });
    const exit = await handle.exited;

    expect(exit.code).toBe(7);
  });

  it("requestStop() sends SIGTERM to the real child, and its own installSignalHandlers-style handling would treat that as an intentional stop", async () => {
    // Writes "ready" before the interval keeps it alive, so the test only
    // sends SIGTERM once the child's own listener is genuinely registered -
    // otherwise this races the child's own startup and can observe the
    // signal's default (unhandled) termination instead of the handler.
    await writeFile(
      join(dir, "dist", "index.js"),
      "process.on('SIGTERM', () => process.exit(0)); process.stdout.write('ready'); setInterval(() => {}, 1000);\n"
    );
    const { stream, text } = collectingStream();

    const handle = spawnWorkerChild({ installDir: dir, logStream: stream });
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (text() === "ready") {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });
    handle.requestStop();
    const exit = await handle.exited;

    expect(exit.code).toBe(0);
  });

  it("really passes --env-file=.env (proven by the child seeing a var only that file defines), resolved relative to installDir via cwd", async () => {
    await writeFile(join(dir, ".env"), "DYO_SPAWN_TEST_MARKER=proof-env-file-was-loaded\n");
    await writeFile(
      join(dir, "dist", "index.js"),
      "process.stdout.write(String(process.env.DYO_SPAWN_TEST_MARKER)); process.exit(0);\n"
    );
    const { stream, text } = collectingStream();

    const handle = spawnWorkerChild({ installDir: dir, logStream: stream });
    await handle.exited;
    await new Promise((resolve) => setImmediate(resolve));

    expect(text()).toBe("proof-env-file-was-loaded");
  });

  it("buildWorkerChildArgs() uses path.join (platform-native separators), never a hand-written forward-slash literal - real production bug, 2026-08-30: a hand-written relative 'dist/index.js' (forward slash) started the worker fine, but DYO-Worker-Final-Update.ps1/DYO-Worker-Lifecycle-SelfTest.ps1's own process-matching regex required a literal backslash and never matched it, so a genuinely healthy, heartbeating worker was falsely reported as not running", () => {
    const args = buildWorkerChildArgs();
    expect(args).toEqual(["--env-file=.env", join("dist", "index.js")]);
  });

  it("buildWorkerChildArgs() is relative, never installDir-anchored - see this function's own CONFIRMED BUG note on why an install-directory-anchored matcher fails against run-worker.bat's always-relative invocation", () => {
    const args = buildWorkerChildArgs();
    expect(args.every((arg) => !path.isAbsolute(arg))).toBe(true);
  });
});
