import { z } from "zod";
import { templateManifestSchema } from "./template-manifest.js";

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
