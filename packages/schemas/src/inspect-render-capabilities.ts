import { z } from "zod";
import { disposableInspectionEvidenceSchema } from "./disposable-inspection.js";

/**
 * READ-ONLY worker capability preparing for final Windows Worker
 * verification (render-delivery phase section 10). We cannot know the
 * client's real AE 2026 Render Queue template names on this (Linux)
 * development machine - this schema/contract exists so the ONE final
 * Windows Worker package can report them for real, without ever guessing
 * a name in code (render-project.ts's own doc comment on
 * renderSettingsTemplateName/outputModuleTemplateName - "not assumed
 * here"). Never mutates the project, never saves, never contacts the
 * client - see apps/worker/src/execution/render/inspect-render-capabilities-script.ts's
 * own doc comment for exactly how this reads AE's real Render Queue
 * template lists without leaving any observable trace.
 */
/**
 * Stage 3: this inspection OPENS a project, so it must name one. It is then
 * inspected through a disposable copy like every other project-opening
 * inspection (see the worker's disposable-project.ts), never by reading
 * whatever After Effects happens to be holding.
 *
 * Both fields are optional so an older API can still dispatch this operation,
 * but a worker that receives neither fails the job closed rather than
 * inspecting an unknown project.
 */
export const inspectRenderCapabilitiesRequestSchema = z
  .object({
    sourceProjectPath: z.string().min(1).optional(),
    sourceProjectSha256: z.string().length(64).optional()
  })
  .strict();
export type InspectRenderCapabilitiesRequest = z.infer<typeof inspectRenderCapabilitiesRequestSchema>;

export const inspectRenderCapabilitiesResponseSchema = z
  .object({
    /** AE's own self-reported version, if determinable - never guessed. */
    aeVersion: z.string().nullable(),
    /** Real Render Settings template names as AE itself reports them right now - never a hardcoded/assumed list. */
    renderSettingsTemplateNames: z.array(z.string()),
    /** Real Output Module template names as AE itself reports them right now. */
    outputModuleTemplateNames: z.array(z.string()),
    capturedAt: z.string().datetime(),
    /** Stage 3 safe-inspection record - see disposable-inspection.ts. Absent on a response from an older worker. */
    safeInspection: disposableInspectionEvidenceSchema.optional()
  })
  .strict();
export type InspectRenderCapabilitiesResponse = z.infer<typeof inspectRenderCapabilitiesResponseSchema>;
