import { createHash, randomUUID } from "node:crypto";
import type { AssetStorage, StoredAssetResult } from "../../../domain/asset-storage/types.js";

/** In-memory fake used only by unit tests - never imported from production code. Mirrors LocalFilesystemAssetStorage's real contract (server-computed sha256, generated names, no path derived from client input). */
export class InMemoryAssetStorage implements AssetStorage {
  private readonly files = new Map<string, Buffer>();
  public deletedKeys: string[] = [];

  async store(input: { projectId: string; buffer: Buffer; extension: string }): Promise<StoredAssetResult> {
    const storageKey = `${input.projectId}/${randomUUID()}.${input.extension}`;
    this.files.set(storageKey, input.buffer);
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    return { storageKey, sha256, byteSize: input.buffer.length };
  }

  async read(storageKey: string): Promise<Buffer> {
    const buffer = this.files.get(storageKey);
    if (!buffer) {
      throw new Error(`No file stored for key ${storageKey}`);
    }
    return buffer;
  }

  async delete(storageKey: string): Promise<void> {
    this.files.delete(storageKey);
    this.deletedKeys.push(storageKey);
  }

  has(storageKey: string): boolean {
    return this.files.has(storageKey);
  }
}
