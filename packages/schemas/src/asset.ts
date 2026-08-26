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

/** PATCH /api/projects/:projectId/assets/:assetId - only ever label/notes; every other fact is fixed at upload time (see section 4: "update label/notes"). */
export const updateAssetRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(200).nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional()
  })
  .strict()
  .refine((value) => value.label !== undefined || value.notes !== undefined, {
    message: "At least one of label or notes must be provided"
  });
export type UpdateAssetRequest = z.infer<typeof updateAssetRequestSchema>;
