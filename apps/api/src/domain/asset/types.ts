import type { MediaKind } from "@dyo/schemas";

export interface AssetRecord {
  id: string;
  projectId: string;
  originalFilename: string;
  storageKey: string;
  mediaKind: MediaKind;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  label: string | null;
  notes: string | null;
  uploadedAt: Date;
  updatedAt: Date;
}

export interface NewAssetRecord {
  id: string;
  projectId: string;
  originalFilename: string;
  storageKey: string;
  mediaKind: MediaKind;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  label: string | null;
  notes: string | null;
}

export interface AssetUpdate {
  label?: string | null;
  notes?: string | null;
}

export interface AssetRepository {
  create(row: NewAssetRecord, now: Date): Promise<AssetRecord>;
  findById(id: string): Promise<AssetRecord | null>;
  listByProjectId(projectId: string): Promise<AssetRecord[]>;
  update(id: string, update: AssetUpdate, now: Date): Promise<AssetRecord | null>;
  /** Returns false (never throws) if the asset was already gone - callers must not treat "already deleted" as an error. */
  delete(id: string): Promise<boolean>;
}
