import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystemAssetStorage } from "../local-filesystem-asset-storage.js";

let root: string;
let storage: LocalFilesystemAssetStorage;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dyo-asset-storage-test-"));
  storage = new LocalFilesystemAssetStorage(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("LocalFilesystemAssetStorage", () => {
  it("stores the file under a project-scoped directory and reads back the exact original bytes", async () => {
    const projectId = randomUUID();
    const buffer = Buffer.from("real png bytes");
    const stored = await storage.store({ projectId, buffer, extension: "png" });

    expect(stored.storageKey.startsWith(`${projectId}/`)).toBe(true);
    expect(stored.byteSize).toBe(buffer.length);
    expect(stored.sha256).toBe(createHash("sha256").update(buffer).digest("hex"));

    const readBack = await storage.read(stored.storageKey);
    expect(readBack.equals(buffer)).toBe(true);
  });

  it("never derives the stored filename from client input - two stores of identical content still get distinct keys, never overwriting each other", async () => {
    const projectId = randomUUID();
    const buffer = Buffer.from("same content");
    const first = await storage.store({ projectId, buffer, extension: "png" });
    const second = await storage.store({ projectId, buffer, extension: "png" });

    expect(first.storageKey).not.toBe(second.storageKey);
    expect((await storage.read(first.storageKey)).equals(buffer)).toBe(true);
    expect((await storage.read(second.storageKey)).equals(buffer)).toBe(true);
  });

  it("never leaves a temp file behind after a successful store - only the final atomically-renamed file exists", async () => {
    const projectId = randomUUID();
    const stored = await storage.store({ projectId, buffer: Buffer.from("x"), extension: "png" });
    const files = readdirSync(join(root, projectId));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(stored.storageKey.split("/")[1]);
    expect(files[0]?.endsWith(".tmp")).toBe(false);
  });

  it("refuses to store against a projectId that is not a real UUID", async () => {
    await expect(storage.store({ projectId: "../../etc", buffer: Buffer.from("x"), extension: "png" })).rejects.toThrow();
  });

  it("refuses a read for a malformed storage key - path traversal is impossible, not just unlikely", async () => {
    await expect(storage.read("../../../../etc/passwd")).rejects.toThrow();
    await expect(storage.read("/etc/passwd")).rejects.toThrow();
    await expect(storage.read(`${randomUUID()}/../../../etc/passwd`)).rejects.toThrow();
    await expect(storage.read("not-even-a-uuid/also-not-a-uuid.png")).rejects.toThrow();
  });

  it("refuses a delete for a malformed storage key", async () => {
    await expect(storage.delete("../../../../etc/passwd")).rejects.toThrow();
  });

  it("refuses a read for a well-formed-looking key that was never actually stored", async () => {
    const fakeKey = `${randomUUID()}/${randomUUID()}.png`;
    await expect(storage.read(fakeKey)).rejects.toThrow();
  });

  it("delete is idempotent - deleting an already-deleted (or never-existing) key never throws", async () => {
    const projectId = randomUUID();
    const stored = await storage.store({ projectId, buffer: Buffer.from("x"), extension: "png" });
    await storage.delete(stored.storageKey);
    await expect(storage.delete(stored.storageKey)).resolves.toBeUndefined();
  });
});
