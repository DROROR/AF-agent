import { z } from "zod";

/**
 * Work Map contract (asset-workmap-intake phase, section 6). Represents
 * USER/CLIENT INTENT for a scene - never a machine-observed SOURCE FACT.
 * `sourceCompositionId`/`sourcePosition` are the only fields that
 * reference the real manifest (so an entry can be tied back to a real
 * scene once one exists) - everything else here is what the client
 * WANTS, which is a fundamentally different kind of fact from what
 * INSPECT_TEMPLATE actually found. This is never silently promoted into
 * an approved execution-plan mapping - a human (or a future, explicit
 * "apply work map" action) must still go through the same typed
 * execution-plan edit operations (MAP_ASSET/SET_TEXT/...) to do that.
 *
 * No canonical DYO work-map file format exists yet (confirmed by reading
 * docs/SHOTSTACK-REFERENCE-POC.md and packages/renderer/src/scene-map -
 * both are a different, paused Shotstack-provider effort, not a DYO
 * work-map contract) - this schema is edited directly via the dashboard;
 * raw-file import is a future adapter, not built here.
 */
export const workMapEntrySchema = z
  .object({
    id: z.string().min(1),
    /** The real manifest composition this entry is about, once a plan exists for the project - null if the client is describing a scene before any template has been inspected. */
    sourceCompositionId: z.string().min(1).nullable(),
    /** Client's own ordering/reference label for this row - independent of any manifest sourcePosition. */
    sourceReference: z.string().min(1).nullable(),
    /** A real asset in this project's own Asset Catalog the client wants used here - never validated against another project's assets (enforced server-side, not just by this schema). */
    desiredAssetId: z.string().min(1).nullable(),
    desiredText: z.string().min(1).nullable(),
    /** Seconds into the desired asset, if it's a video - client intent, not yet a confirmed execution instruction. */
    assetTimestampSeconds: z.number().nonnegative().nullable(),
    desiredDurationSeconds: z.number().positive().nullable(),
    instructions: z.string().min(1).nullable()
  })
  .strict();
export type WorkMapEntry = z.infer<typeof workMapEntrySchema>;

export const workMapSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().uuid(),
  revision: z.number().int().positive(),
  entries: z.array(workMapEntrySchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type WorkMap = z.infer<typeof workMapSchema>;

export const workMapResponseSchema = z.object({ workMap: workMapSchema.nullable() });
export type WorkMapResponse = z.infer<typeof workMapResponseSchema>;

/**
 * PUT /api/projects/:projectId/work-map - replaces the entire entry list
 * as one new revision (optimistic concurrency, same pattern as
 * execution-plan's update: baseRevision 0 means "no work map exists yet,
 * create the first revision").
 */
export const updateWorkMapRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  entries: z.array(workMapEntrySchema.omit({ id: true }).extend({ id: z.string().min(1).optional() }))
});
export type UpdateWorkMapRequest = z.infer<typeof updateWorkMapRequestSchema>;
