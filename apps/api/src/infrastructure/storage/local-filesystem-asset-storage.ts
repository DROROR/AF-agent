import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { AssetStorage, StoredAssetResult } from "../../domain/asset-storage/types.js";

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `<projectId>/<generatedUuid>.<ext>` - the only shape a real storageKey this class ever produces can have. Any read/delete call with a key that doesn't match this exactly is refused before it ever reaches a filesystem path, regardless of what it contains. */
const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/i;

/**
 * MVP AssetStorage implementation - a plain directory tree, never `/tmp`
 * (the configured root is expected to be a real, persistent path - see
 * env.ts's ASSET_STORAGE_ROOT). Every generated name is a fresh UUID, so
 * two uploads can never collide or overwrite each other regardless of the
 * client's original filename. Writes go to a sibling temp file first and
 * are only made visible via an atomic `rename` on success - a reader can
 * never observe a partially-written file under the final name.
 */
export class LocalFilesystemAssetStorage implements AssetStorage {
  constructor(private readonly root: string) {}

  async store(input: { projectId: string; buffer: Buffer; extension: string }): Promise<StoredAssetResult> {
    if (!PROJECT_ID_PATTERN.test(input.projectId)) {
      throw new Error("projectId must be a real UUID - refusing to derive a storage path from anything else");
    }
    const extension = input.extension.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!extension) {
      throw new Error("A real, allowlisted file extension is required");
    }

    const projectDir = join(this.root, input.projectId);
    await mkdir(projectDir, { recursive: true });

    const generatedName = `${randomUUID()}.${extension}`;
    const finalPath = join(projectDir, generatedName);
    const tempPath = `${finalPath}.${randomUUID()}.tmp`;

    // `wx` refuses to overwrite an existing file - combined with a fresh
    // UUID per upload, this makes an accidental overwrite-by-name
    // structurally impossible, not just unlikely.
    await writeFile(tempPath, input.buffer, { flag: "wx" });
    try {
      await rename(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }

    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    return { storageKey: `${input.projectId}/${generatedName}`, sha256, byteSize: input.buffer.length };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveSafePath(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolveSafePath(storageKey), { force: true });
  }

  /**
   * Path traversal is refused twice: the storageKey must match the exact
   * shape this class itself generates (rejecting `../`, absolute paths,
   * null bytes, or anything else outright), AND the final resolved path
   * is independently verified to still be inside `root` before any
   * filesystem call is made.
   */
  private resolveSafePath(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new Error("Refusing to resolve a malformed storage key");
    }
    const resolvedRoot = resolve(this.root);
    const resolvedPath = resolve(this.root, storageKey);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
      throw new Error("Refusing to resolve a storage key that escapes the storage root");
    }
    return resolvedPath;
  }
}
