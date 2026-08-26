import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashSourceProject } from "./hash-source-project.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-hash-source-project-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("hashSourceProject", () => {
  it("hashes a real file's exact bytes, matching an independently-computed sha256", async () => {
    const filePath = join(dir, "template-copy.aep");
    const content = "sanitized fixture bytes - not a real .aep, just needs to exist on disk";
    await writeFile(filePath, content);

    const result = await hashSourceProject(filePath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe(filePath);
      expect(result.value.name).toBe("template-copy.aep");
      expect(result.value.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    }
  });

  it("fails honestly (never fabricates a hash) when the file does not exist", async () => {
    const result = await hashSourceProject(join(dir, "does-not-exist.aep"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/cannot access/);
    }
  });

  it("fails when the path is a directory, not a regular file", async () => {
    const result = await hashSourceProject(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not a regular file/);
    }
  });

  it("produces a different hash for different content at the same file name", async () => {
    const nested1 = join(dir, "a");
    const nested2 = join(dir, "b");
    await mkdir(nested1);
    await mkdir(nested2);
    await writeFile(join(nested1, "copy.aep"), "content one");
    await writeFile(join(nested2, "copy.aep"), "content two");

    const first = await hashSourceProject(join(nested1, "copy.aep"));
    const second = await hashSourceProject(join(nested2, "copy.aep"));

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.sha256).not.toBe(second.value.sha256);
    }
  });
});
