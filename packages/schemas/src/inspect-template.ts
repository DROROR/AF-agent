import { z } from "zod";
import { templateManifestSchema } from "./template-manifest.js";

/**
 * Request/response contract for the INSPECT_TEMPLATE worker operation
 * (already a recognized entry in WORKER_CAPABILITIES - see worker.ts).
 * Dispatched via POST /api/jobs (dispatch-job.ts) and its result read back
 * via GET /api/jobs/:jobId (get-job-for-user.ts) - a SUCCEEDED job's own
 * `result` field validates against inspectTemplateResponseSchema below.
 * See docs/TEMPLATE-INSPECTOR.md.
 */

/**
 * Case-insensitive .aep suffix check - the one shared rule every layer
 * (this request schema, the worker's own filesystem check in
 * hash-source-project.ts, and the New Project wizard's own client-side
 * "Inspect" gate) validates a candidate source project path against, so
 * the three checks can never quietly drift out of sync with each other.
 * Deliberately extension-only: a real file/directory check requires
 * filesystem access, which only the worker has - see CLAUDE.md Safety
 * Rule 8 and hash-source-project.ts's own stat()+isFile() check, which
 * this does NOT replace.
 */
export function hasAepExtension(path: string): boolean {
  return /\.aep$/i.test(path.trim());
}

export const inspectTemplateRequestSchema = z.object({
  templateId: z.string().min(1),
  /**
   * Path to a COPY of the source .aep, never the original - CLAUDE.md
   * Safety Rule 1 ("never overwrite the original .aep template") and the
   * Phase 5 first-real-test plan ("use a project copy for the first real
   * inspection, even though the inspector is intended to be read-only").
   * Must end in .aep (case-insensitive) - a bare directory or a
   * non-.aep file is rejected here rather than only discovered later by
   * the worker's own filesystem check (real client bug, 2026-08-30: a
   * directory-only path was accepted and silently produced a fallback
   * "raw_capture" result instead of being rejected up front).
   */
  sourceProjectPath: z.string().min(1, "Source project path is required").refine(hasAepExtension, {
    message: "Source project path must be a file path ending in .aep"
  })
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

/**
 * One real, allowlisted MCP tool call captured verbatim during inspection -
 * mirrors apps/worker/src/inspection/template-inspector.ts's own
 * RawToolCallCapture. `content` is intentionally `z.unknown()`: it is
 * upstream's raw MCP response content, never assumed to contain any
 * particular field by a consumer outside the worker itself.
 */
export const inspectionToolCallCaptureSchema = z.object({
  tool: z.string(),
  calledAt: z.string(),
  ok: z.boolean(),
  content: z.unknown().optional(),
  truncated: z.boolean().optional(),
  originalContentLength: z.number().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional()
});
export type InspectionToolCallCapture = z.infer<typeof inspectionToolCallCaptureSchema>;

/**
 * P0 fix (2026-09-03, real production incident): proof that AE actually
 * had the REQUESTED sourceProjectPath open - not just whatever project
 * happened to already be open - before any manifest facts were read. A
 * real client attempt proved AE can have an unrelated project open (e.g.
 * "Untitled", projectPath: null); INSPECT_TEMPLATE now actively verifies
 * this rather than assuming it. `matched` is the one field future
 * acceptance checks should read: true only when `actualOpenedPath`
 * (AE's own self-reported, re-queried path after the open attempt - or
 * the path it already had open, if reused) exactly canonically equals
 * `requestedPath`. `reused: true` means AE already had exactly the right
 * file open and no open call was made at all.
 */
export const projectOpenEvidenceSchema = z.object({
  requestedPath: z.string(),
  actualOpenedPath: z.string().nullable(),
  reused: z.boolean(),
  matched: z.boolean(),
  note: z.string().optional()
});
export type ProjectOpenEvidence = z.infer<typeof projectOpenEvidenceSchema>;

/**
 * Fallback INSPECT_TEMPLATE result for when a real TemplateManifest could
 * not honestly be built - mirrors template-inspector.ts's own
 * RawInspectionCapture. A job whose persisted `result` has this shape must
 * NEVER be treated as a successful template inspection by any consumer
 * (worker-side job-dispatcher.ts, or a dashboard client parsing a
 * SUCCEEDED... in practice a FAILED job's `result`) - see
 * inspectTemplateResultSchema below, the shared contract both sides parse
 * against. `projectOpenEvidence` is present only when the P0 open/verify
 * step itself ran and is the reason this fell back to a raw capture
 * (`matched: false`) - absent when the fallback happened for an unrelated
 * reason (e.g. a later discovery tool failure, an invalid sourceProjectPath).
 */
export const rawInspectionCaptureSchema = z.object({
  kind: z.literal("raw_capture"),
  /** Stamped by job-dispatcher.ts, which owns job identity. */
  workerId: z.string().optional(),
  jobId: z.string().optional(),
  capturedAt: z.string(),
  toolCalls: z.array(inspectionToolCallCaptureSchema),
  note: z.string(),
  projectOpenEvidence: projectOpenEvidenceSchema.optional()
});
export type RawInspectionCapture = z.infer<typeof rawInspectionCaptureSchema>;

/**
 * A finalized, schema-validated TemplateManifest result - mirrors
 * template-inspector.ts's own ManifestInspectionResult. `response` is the
 * exact same shape inspectTemplateResponseSchema validates.
 * `projectOpenEvidence` is always present here (`matched: true`) - a
 * manifest is never built unless the P0 open/verify step already
 * succeeded, so this is durable proof, persisted alongside the manifest
 * itself, that the Worker really did inspect the intended AEP.
 */
export const manifestInspectionResultSchema = z.object({
  kind: z.literal("manifest"),
  response: inspectTemplateResponseSchema,
  diagnostics: z.array(inspectionToolCallCaptureSchema),
  projectOpenEvidence: projectOpenEvidenceSchema
});
export type ManifestInspectionResult = z.infer<typeof manifestInspectionResultSchema>;

/**
 * The REAL persisted shape of a completed INSPECT_TEMPLATE job's `result`
 * column - a discriminated union on `kind`, never the bare
 * InspectTemplateResponse shape alone. Any consumer that reads
 * job.result for INSPECT_TEMPLATE (the dashboard's New Project wizard
 * included) must parse against THIS schema first and branch on `.kind` -
 * parsing job.result directly against inspectTemplateResponseSchema will
 * always fail, because `manifest`/`summary` live one level deeper, under
 * `.response`, only when `kind === "manifest"`.
 */
export const inspectTemplateResultSchema = z.discriminatedUnion("kind", [
  manifestInspectionResultSchema,
  rawInspectionCaptureSchema
]);
export type InspectTemplateResult = z.infer<typeof inspectTemplateResultSchema>;
