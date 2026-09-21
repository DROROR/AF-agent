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
  /** What the FILE can carry, measured from its bytes. Evidence only - never proof that any pixel is transparent. */
  hasAlphaChannel: boolean | null;
  /** How the transparency facts were obtained: DECODED, NO_ALPHA_CHANNEL, NOT_DECODED. Null = never analysed. */
  pixelAnalysis: string | null;
  /** What the PIXELS actually contain. Null = could not be decoded, which is "unknown", never "opaque". */
  hasTransparentPixels: boolean | null;
  transparentPixelRatio: number | null;
  visibleCoverageRatio: number | null;
  visibleContentBounds: { xPx: number; yPx: number; widthPx: number; heightPx: number } | null;
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
  hasAlphaChannel: boolean | null;
  pixelAnalysis: string | null;
  hasTransparentPixels: boolean | null;
  transparentPixelRatio: number | null;
  visibleCoverageRatio: number | null;
  visibleContentBounds: { xPx: number; yPx: number; widthPx: number; heightPx: number } | null;
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
