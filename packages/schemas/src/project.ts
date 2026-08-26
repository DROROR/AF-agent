import { z } from "zod";
import { templateManifestSchema } from "./template-manifest.js";

/**
 * Client's OWN brand inputs for this project - their logo/colors/text
 * instructions, distinct from DYO's own PERMANENT brand rules
 * (dyo-brand-rules.yaml: the DYO logo, the Hebrew "מבית DYO App" line, the
 * official DYO blue - CLAUDE.md's "Permanent DYO Brand Rules" section,
 * unaffected by anything here and never overridden by a client value).
 * None of this is executed in After Effects by this phase - it is input
 * only, collected before semantic mapping exists.
 */
export const projectBrandInputsSchema = z
  .object({
    /** A real asset id in this project's own Asset Catalog - never validated against another project's assets (enforced server-side). */
    logoAssetId: z.string().min(1).nullable(),
    /** Client's own brand colors as hex strings, e.g. "#1A2B3C" - never validated as "matching" anything, just stored. */
    brandColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(10),
    textInstructions: z.string().trim().max(4000).nullable()
  })
  .strict();
export type ProjectBrandInputs = z.infer<typeof projectBrandInputsSchema>;

const DEFAULT_BRAND_INPUTS: ProjectBrandInputs = { logoAssetId: null, brandColors: [], textInstructions: null };

/** PATCH /api/projects/:projectId/brand-inputs - replaces the whole brand-inputs object (small enough that partial-field PATCH semantics aren't worth the complexity). */
export const updateProjectBrandInputsRequestSchema = projectBrandInputsSchema;
export type UpdateProjectBrandInputsRequest = z.infer<typeof updateProjectBrandInputsRequestSchema>;

export { DEFAULT_BRAND_INPUTS };

/**
 * The durable anchor for "one project" (Phase 4 section 9) - a validated
 * TemplateManifest a dashboard operator has chosen to plan against.
 * Nothing before this phase persisted a manifest anywhere; it previously
 * only ever lived transiently in a job's own result column.
 */
export const projectDtoSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string(),
  templateId: z.string().min(1),
  sourceProjectSha256: z.string().min(1),
  brandInputs: projectBrandInputsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ProjectDto = z.infer<typeof projectDtoSchema>;

/** POST /api/projects - a dashboard operator promotes one already-produced, schema-valid manifest (e.g. from a SUCCEEDED INSPECT_TEMPLATE job) into a durable project. Never re-derives or re-validates the manifest's own facts beyond schema shape - that already happened when the job produced it. */
export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  manifest: templateManifestSchema
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const projectResponseSchema = z.object({ project: projectDtoSchema, manifest: templateManifestSchema });
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const listProjectsResponseSchema = z.object({ projects: z.array(projectDtoSchema) });
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;
