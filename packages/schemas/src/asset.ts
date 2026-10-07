import { z } from "zod";

/**
 * Real Asset Catalog domain model (asset-workmap-intake phase). `mediaKind`
 * is a strict, machine-derived-or-explicitly-labeled fact - never a
 * semantic role guess ("phone-screen", "background", "hero"). LOGO is the
 * one kind a human explicitly assigns at upload time (see
 * asset-storage.ts's mime-to-kind map); every other kind is derived
 * directly from the real, sniffed MIME type, never from the filename.
 */
export const MEDIA_KINDS = ["IMAGE", "VIDEO", "LOGO", "AUDIO", "DOCUMENT", "OTHER"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const mediaKindSchema = z.enum(MEDIA_KINDS);

export const assetDtoSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().uuid(),
  originalFilename: z.string().min(1),
  /** Opaque, server-generated storage identifier - never the original filename, never a filesystem path. See asset-storage.ts. */
  storageKey: z.string().min(1),
  mediaKind: mediaKindSchema,
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /**
   * MEASURED IMAGE FACTS, kept apart on purpose: `hasAlphaChannel` is what the
   * FILE can carry, `hasTransparentPixels`/`transparentPixelRatio` are what its
   * PIXELS contain, and `visibleCoverageRatio`/`visibleContentBounds` say where
   * that content actually is. A null pixel fact means "could not be decoded",
   * which is neither opaque nor transparent. All optional, so payloads produced
   * before they existed still parse.
   */
  hasAlphaChannel: z.boolean().nullable().optional(),
  hasTransparentPixels: z.boolean().nullable().optional(),
  transparentPixelRatio: z.number().min(0).max(1).nullable().optional(),
  visibleCoverageRatio: z.number().min(0).max(1).nullable().optional(),
  visibleContentBounds: z
    .object({ xPx: z.number().nonnegative(), yPx: z.number().nonnegative(), widthPx: z.number().positive(), heightPx: z.number().positive() })
    .strict()
    .nullable()
    .optional(),
  durationSeconds: z.number().nonnegative().nullable(),
  label: z.string().nullable(),
  notes: z.string().nullable(),
  uploadedAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type AssetDto = z.infer<typeof assetDtoSchema>;

export const listAssetsResponseSchema = z.object({ assets: z.array(assetDtoSchema) });
export type ListAssetsResponse = z.infer<typeof listAssetsResponseSchema>;

export const assetResponseSchema = z.object({ asset: assetDtoSchema });
export type AssetResponse = z.infer<typeof assetResponseSchema>;

/**
 * PATCH /api/projects/:projectId/assets/:assetId - label/notes, and (2026-10-07)
 * whether a still image is the logo. A client uploaded his logo in the
 * picture box, and only a file placed as a logo counts for the brand rule;
 * a file's kind could not be changed after upload, so the only way out was
 * to upload it again. IMAGE <-> LOGO is the one change allowed: both are the
 * same sniffed image file, and LOGO was always the one kind a person assigns.
 * Every other fact is still fixed at upload time.
 */
export const updateAssetRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(200).nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
    mediaKind: z.enum(["IMAGE", "LOGO"]).optional()
  })
  .strict()
  .refine((value) => value.label !== undefined || value.notes !== undefined || value.mediaKind !== undefined, {
    message: "At least one of label, notes or mediaKind must be provided"
  });
export type UpdateAssetRequest = z.infer<typeof updateAssetRequestSchema>;
