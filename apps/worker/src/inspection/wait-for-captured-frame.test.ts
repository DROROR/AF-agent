import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { waitForCapturedFrame } from "./wait-for-captured-frame.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "captured-frame-"));
  cleanupDirs.push(dir);
  return dir;
}

const FAST = { timeoutMs: 400, pollIntervalMs: 20 };

/**
 * Real 2026-10-02 failure (project fe32ffac, "!MAIN"): ae-mcp returned the
 * frame's path before After Effects had written it, and a single immediate
 * stat reported ENOENT for a preview that was on its way.
 */
describe("waitForCapturedFrame", () => {
  it("accepts a frame that is already complete on disk", async () => {
    const filePath = join(tempDir(), "Scene_01_1.png");
    writeFileSync(filePath, Buffer.alloc(69, 1));

    expect(await waitForCapturedFrame(filePath, FAST)).toEqual({ ok: true, bytes: 69 });
  });

  it("waits for a frame that After Effects writes after the capture call has already returned", async () => {
    const filePath = join(tempDir(), "_MAIN_1790952469969.png");
    const writer = setTimeout(() => writeFileSync(filePath, Buffer.alloc(2048, 1)), 120);

    const result = await waitForCapturedFrame(filePath, { timeoutMs: 2_000, pollIntervalMs: 20 });
    clearTimeout(writer);

    expect(result).toEqual({ ok: true, bytes: 2048 });
  });

  it("never hands on a frame that is still growing", async () => {
    const filePath = join(tempDir(), "growing.png");
    writeFileSync(filePath, Buffer.alloc(10, 1));
    const writer = setTimeout(() => writeFileSync(filePath, Buffer.alloc(5000, 1)), 10);

    const result = await waitForCapturedFrame(filePath, { timeoutMs: 2_000, pollIntervalMs: 40 });
    clearTimeout(writer);

    expect(result).toEqual({ ok: true, bytes: 5000 });
  });

  it("reports a frame that never arrives, naming the wait and the real filesystem error", async () => {
    const result = await waitForCapturedFrame(join(tempDir(), "never.png"), FAST);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/^could not verify the captured preview file on disk after waiting 0 s \(ENOENT/);
  });

  it("rejects a file that stays empty, and anything that is not a regular file", async () => {
    const dir = tempDir();
    const emptyPath = join(dir, "empty.png");
    writeFileSync(emptyPath, "");
    const folderPath = join(dir, "folder.png");
    mkdirSync(folderPath);

    const expected = { ok: false, reason: "captured preview file exists but is empty or not a regular file" };
    expect(await waitForCapturedFrame(emptyPath, FAST)).toEqual(expected);
    expect(await waitForCapturedFrame(folderPath, FAST)).toEqual(expected);
  });
});
