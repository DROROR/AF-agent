import { z } from "zod";
import { templateManifestSchema } from "./template-manifest.js";

/**
 * Request/response contract for the INSPECT_TEMPLATE worker operation
 * (already a recognized entry in WORKER_CAPABILITIES - see worker.ts).
 * This is the CONTRACT only - no job-dispatch transport exists yet to
 * actually deliver this request to a worker or return this response from
 * one. See docs/TEMPLATE-INSPECTOR.md.
 */

export const inspectTemplateRequestSchema = z.object({
  templateId: z.string().min(1),
  /**
   * Path to a COPY of the source .aep, never the original - CLAUDE.md
   * Safety Rule 1 ("never overwrite the original .aep template") and the
   * Phase 5 first-real-test plan ("use a project copy for the first real
   * inspection, even though the inspector is intended to be read-only").
   */
  sourceProjectPath: z.string().min(1)
});
export type InspectTemplateRequest = z.infer<typeof inspectTemplateRequestSchema>;

export const inspectionSummarySchema = z.object({
  compositionCount: z.number().int().nonnegative(),
  candidateSceneCount: z.number().int().nonnegative(),
  editablePlaceholderCount: z.number().int().nonnegative(),
  nestedCompositionCount: z.number().int().nonnegative(),
  requiredFontCount: z.number().int().nonnegative(),
  footageReferencedCount: z.number().int().nonnegative(),
  missingFootageCount: z.number().int().nonnegative(),
  pluginReferenceCount: z.number().int().nonnegative(),
  unknownItemCount: z.number().int().nonnegative()
});
export type InspectionSummary = z.infer<typeof inspectionSummarySchema>;

export const inspectTemplateResponseSchema = z.object({
  manifest: templateManifestSchema,
  summary: inspectionSummarySchema
});
export type InspectTemplateResponse = z.infer<typeof inspectTemplateResponseSchema>;
