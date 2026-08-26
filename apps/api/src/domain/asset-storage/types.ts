/**
 * Storage abstraction the application layer depends on - never a direct
 * filesystem call outside an AssetStorage implementation. This is what
 * lets a later S3/R2 adapter replace LocalFilesystemAssetStorage without
 * any change to upload-asset.ts/delete-asset.ts or the domain model.
 */
export interface StoredAssetResult {
  /** Opaque identifier this storage implementation can later read/delete by - never a filesystem path exposed to a browser client. */
  storageKey: string;
  /** Computed by the storage implementation from the actual bytes it wrote - never trusted from the caller. */
  sha256: string;
  byteSize: number;
}

export interface AssetStorage {
  /**
   * Writes `buffer` under a server-generated name scoped to `projectId` -
   * `originalFilename` is never used to build a path (only kept as
   * display metadata by the caller). `extension` must already be a real,
   * allowlisted one (see mime-allowlist.ts) - this function trusts its
   * caller on that point but still refuses a malformed one defensively.
   */
  store(input: { projectId: string; buffer: Buffer; extension: string }): Promise<StoredAssetResult>;
  /** Reads the full file back - used only for streaming a preview/download response server-side, never to hand a raw path to the browser. */
  read(storageKey: string): Promise<Buffer>;
  /** Never throws if the file is already gone - deleting an already-deleted asset's file is a no-op, not an error. */
  delete(storageKey: string): Promise<void>;
}
