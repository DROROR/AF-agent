import { z } from "zod";
import { checkHealthRequestSchema } from "./check-health.js";
import { inspectTemplateRequestSchema } from "./inspect-template.js";
import { inspectRenderCapabilitiesRequestSchema } from "./inspect-render-capabilities.js";
import { renderOutputVariantSchema } from "./render-project.js";
import { jobStatusSchema } from "./job.js";
import { MAX_PREVIEW_TIMING_CHAIN_TARGETS } from "./scene-evidence.js";

/**
 * Operations a dashboard operator may dispatch via POST /api/jobs - a
 * strict subset of WORKER_CAPABILITIES (worker.ts). Adding a new
 * operation here means it has a real, reviewed, allowlisted request
 * contract below; this is never a generic "run any capability" endpoint,
 * and never accepts an arbitrary operation string - see CLAUDE.md Safety
 * Rule 2 ("never execute arbitrary AI-generated JSX... only tested,
 * versioned, allowlisted scripts/operations").
 */
export const DISPATCHABLE_OPERATIONS = [
  "INSPECT_TEMPLATE",
  "CHECK_HEALTH",
  "INSPECT_SCENE_EVIDENCE",
  "INSPECT_RENDER_CAPABILITIES",
  "EXECUTE_FRAME",
  "CREATE_PREVIEW",
  "RENDER"
] as const;
export type DispatchableOperation = (typeof DISPATCHABLE_OPERATIONS)[number];
export const dispatchableOperationSchema = z.enum(DISPATCHABLE_OPERATIONS);

/**
 * POST /api/jobs request body - a discriminated union keyed by
 * `operation`, so each operation's payload is validated against its own
 * real, reviewed contract right here at the boundary, never
 * `z.unknown()`/`z.any()`. CHECK_HEALTH's payload is a strict empty
 * object - no command string, no path, no arbitrary field is ever
 * accepted for it. Defense in depth alongside create-job.ts's own
 * validateJobPayload() call, which validates again independently.
 *
 * EXECUTE_FRAME/RENDER/INSPECT_SCENE_EVIDENCE deliberately carry NO
 * `payload` field at all - unlike INSPECT_TEMPLATE/CHECK_HEALTH (which are
 * not project-bound and have no server-resolvable worker payload to build
 * in the first place), these three accept ONLY a minimal, non-addressing
 * intent (`executionSessionId` + `scenePlanId` / `variant`, or bare
 * `scenePlanId` for INSPECT_SCENE_EVIDENCE). The real worker-facing
 * ExecuteSceneEditRequest/RenderProjectRequest/SceneEvidenceRequest
 * (Windows paths, composition indices, JSX operations, aerender template
 * names, layer indices) is entirely SERVER-RESOLVED from trusted persisted
 * state (see resolve-execute-frame-dispatch.ts/resolve-render-dispatch.ts/
 * resolve-inspect-scene-evidence-dispatch.ts), never accepted from a
 * browser/API caller (activation-phase sections 2-4, extended to
 * INSPECT_SCENE_EVIDENCE by the offline-safe-control-plane phase: "browser/
 * API callers must NOT provide raw worker payloads").
 * `workerId` here is never trusted as "the worker to use" by itself for
 * these two operations - dispatch-job.ts independently verifies it equals
 * the execution session's own `assignedWorkerId` (multi-scene-accumulation
 * phase, section 8: "worker affinity" - a session's cumulative working
 * copy exists on ONE worker's local disk, so it can never be dispatched to
 * a different one). INSPECT_RENDER_CAPABILITIES needs no project/scene/
 * session context at all - its payload is a fixed empty object, identical
 * in spirit to CHECK_HEALTH's.
 */
export const dispatchJobRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("INSPECT_TEMPLATE"),
    workerId: z.string().uuid(),
    payload: inspectTemplateRequestSchema
  }),
  z.object({
    operation: z.literal("CHECK_HEALTH"),
    workerId: z.string().uuid(),
    payload: checkHealthRequestSchema
  }),
  z
    .object({
      operation: z.literal("INSPECT_SCENE_EVIDENCE"),
      workerId: z.string().uuid(),
      /**
       * Required (unlike INSPECT_TEMPLATE/CHECK_HEALTH, which are not
       * project-bound) - a successful result can only be persisted as scene
       * evidence (see record-scene-evidence.ts) if the job that produced it is
       * attributable to a real project.
       */
      projectId: z.string().uuid(),
      /**
       * "Improve AI accuracy" / offline-safe-control-plane phase: this used
       * to accept a raw `payload: sceneEvidenceRequestSchema` straight from
       * the caller - including `sourceProjectPath`, a real Windows
       * filesystem path - which is exactly the "no arbitrary worker payload
       * passthrough from the browser" rule EXECUTE_FRAME/RENDER already
       * enforce (see this module's own doc comment above). Now a minimal
       * intent, same shape as EXECUTE_FRAME minus executionSessionId (scene
       * evidence is read-only and has no execution session to pin to): the
       * real SceneEvidenceRequest (sourceProjectPath/sourceProjectSha256/
       * aeProjectItemIndex/compositionName/layerIndices) is entirely
       * SERVER-RESOLVED from the project's current manifest and execution
       * plan - see resolve-inspect-scene-evidence-dispatch.ts.
       */
      scenePlanId: z.string().min(1),
      /**
       * Live-QA "generic AE layer-discovery capability" requirement -
       * opt-in intent flag only (never a raw worker payload/path - the
       * real SceneEvidenceRequest.discoverLayerDetails this becomes is
       * still entirely server-resolved from trusted state alongside every
       * other field, see resolve-inspect-scene-evidence-dispatch.ts).
       * Omitted/false preserves the exact prior INSPECT_SCENE_EVIDENCE
       * behavior for every existing caller.
       */
      discoverLayerDetails: z.boolean().optional(),
      /**
       * Preview Timing Analysis (live QA, 2026-09-09, extended to
       * arbitrary nested depth 2026-09-10) - opt-in intent flag only, same
       * "never a raw worker payload passthrough" convention as
       * discoverLayerDetails above. When present, resolveInspectSceneEvidenceDispatch
       * takes a completely different branch: instead of the scene's own
       * top-level manifestCompositionId, it derives the distinct NESTED
       * composition+layerIndices targets from the scene's own real,
       * approved mappings' COMPLETE humanNestedTarget chains, at ANY
       * depth (derivePreviewTimingTargets) - and dispatches against
       * whichever target is at this 0-based index - never a
       * caller-supplied compositionId/layerIndices. Bounded by
       * MAX_PREVIEW_TIMING_CHAIN_TARGETS (see its own doc comment for why
       * this is a generous safety bound, not a scope limit). Omitted
       * preserves the exact prior INSPECT_SCENE_EVIDENCE behavior for
       * every existing caller.
       */
      previewTimingChainIndex: z
        .number()
        .int()
        .min(0)
        .max(MAX_PREVIEW_TIMING_CHAIN_TARGETS - 1)
        .optional(),
      /**
       * Preview Timing Analysis composition-GRAPH discovery (live QA,
       * 2026-09-09/10 real incidents, session a7fee3d9): a mapping's own
       * `humanNestedTarget` never records how its OWN starting
       * composition (e.g. "Scene 1") is actually placed inside the
       * scene's real master/render composition (e.g. "!Render") - that
       * placement is real AE composition-graph structure. As of the
       * 2026-09-10 FIX 2 extension, the PRIMARY source for that placement
       * is the project's own manifest (`parentCompositionIds`, already
       * AE-confirmed by the original INSPECT_TEMPLATE inspection) - see
       * deriveManifestContainmentPath in apps/web/src/lib/preview-timing.ts.
       * This dispatch field is used only for the ONE thing the manifest
       * cannot supply: the real AE layerIndex inside a manifest-confirmed
       * parent composition that hosts a manifest-confirmed child - one
       * targeted lookup per already-known hop, never a broad/exploratory
       * scan of sibling compositions the way the original (now retired)
       * live graph search did.
       *
       * This is the one deliberate, narrowly-scoped exception in this
       * codebase to "the server always resolves composition/layer
       * addressing, a caller never supplies it directly" (see this
       * module's own doc comment and resolveExecuteFrameDispatch's
       * identical rule): safe here specifically because (a) this
       * operation is READ-ONLY (INSPECT_SCENE_EVIDENCE never saves,
       * mutates, or renders - CLAUDE.md Safety Rules 1-3), (b) the
       * resolver validates this value against the CURRENT PROJECT
       * MANIFEST's own real composition list before ever dispatching
       * anything - a caller can only ever name a composition this
       * project's own manifest already knows about, never an arbitrary
       * string, (c) it always dispatches in the new lightweight
       * "discovery" mode (never the heavier per-layer stretch/
       * timeRemapEnabled/opacity reads), and (d) it never accepts
       * layerIndices from the caller either - always every plausible
       * index up to MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST, server-
       * computed. Mutually exclusive with previewTimingChainIndex in
       * practice (the resolver checks this field first) - never both
       * meaningfully set on the same dispatch.
       */
      previewTimingDiscoverCompositionId: z.string().min(1).optional(),
      /**
       * Preview Timing Analysis TARGETED HOST-LAYER LOOKUP (live QA,
       * 2026-09-10 real incident, session a7fee3d9) - only meaningful
       * alongside previewTimingDiscoverCompositionId, which names the
       * PARENT. This field names the CHILD composition (already confirmed
       * as a real child of previewTimingDiscoverCompositionId by the
       * manifest's own `parentCompositionIds`) whose hosting layer(s) are
       * being looked up.
       *
       * This REPLACES the prior "discovery mode + early-exit target"
       * mechanism, which was proven insufficient by a real retry: even a
       * trimmed, early-exiting scan still classifies/constructs an object
       * for every layer up to wherever the match happens to be, and that
       * per-layer classification cost alone was enough to time out on a
       * large parent such as "!Render" (~40+ layers). This field now
       * drives a genuinely different Worker operation
       * (buildFindHostLayersScript) that does ZERO classification/object-
       * construction work for a non-matching layer - only the cheapest
       * possible check (`layer.source instanceof CompItem` plus a string
       * id comparison) - and performs the full property reads only for
       * actual matches. It also never breaks early: a child composition
       * can be placed at multiple layers within the same parent, and every
       * real instance must be reported (see hostLayerRecords on
       * sceneEvidenceResponseSchema), never silently narrowed to the
       * first.
       *
       * Subject to the exact same safety reasoning as
       * previewTimingDiscoverCompositionId above (both values validated
       * against the current manifest before dispatch, never an arbitrary
       * string).
       */
      previewTimingFindHostLayersChildCompositionId: z.string().min(1).optional()
    })
    .strict(),
  z.object({
    operation: z.literal("INSPECT_RENDER_CAPABILITIES"),
    workerId: z.string().uuid(),
    payload: inspectRenderCapabilitiesRequestSchema
  }),
  z
    .object({
      operation: z.literal("EXECUTE_FRAME"),
      workerId: z.string().uuid(),
      projectId: z.string().uuid(),
      executionSessionId: z.string().uuid(),
      scenePlanId: z.string().min(1),
      /**
       * First Preview regeneration (live QA, 2026-09-08/09) - opt-in
       * intent flag only, same "omitted/false preserves the exact prior
       * behavior for every existing caller" convention as
       * discoverLayerDetails above. The real ExecuteSceneEditRequest this
       * becomes (operations: [], previewOnly: true, ...) is still entirely
       * server-resolved from trusted session/plan/manifest state via
       * resolveExecuteFrameDispatch's own previewOnly branch - never a raw
       * worker payload passthrough from the browser.
       */
      regeneratePreviewOnly: z.boolean().optional(),
      /** Only meaningful alongside regeneratePreviewOnly - see executeSceneEditRequestSchema's own previewTimestampSeconds doc comment. */
      previewTimestampSeconds: z.number().nonnegative().finite().optional(),
      /**
       * Landscape output-composition build (live QA, 2026-09-10 urgent
       * request) - opt-in intent flag only, same "omitted/false preserves
       * the exact prior behavior for every existing caller" convention as
       * regeneratePreviewOnly above. Targets a scene that has ALREADY
       * completed in this session (the opposite precondition of a normal
       * dispatch - this scene's own real, approved content must already be
       * baked into the working copy before it is safe to duplicate/adapt),
       * and produces a single-operation dispatch
       * (operations: [BUILD_HORIZONTAL_COMPOSITION], approvedMappingIds:
       * []) entirely server-resolved via resolveExecuteFrameDispatch's own
       * buildHorizontalCompositionOnly branch - never a raw worker payload
       * passthrough from the browser, and never a caller-supplied
       * composition name/geometry of any kind.
       */
      buildHorizontalCompositionOnly: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      operation: z.literal("CREATE_PREVIEW"),
      workerId: z.string().uuid(),
      projectId: z.string().uuid(),
      executionSessionId: z.string().uuid()
    })
    .strict(),
  z
    .object({
      operation: z.literal("RENDER"),
      workerId: z.string().uuid(),
      projectId: z.string().uuid(),
      executionSessionId: z.string().uuid(),
      variant: renderOutputVariantSchema
    })
    .strict()
]);
export type DispatchJobRequest = z.infer<typeof dispatchJobRequestSchema>;

/** Safe DTO only - never the worker's token/tokenHash, never any other job's internal fields. */
export const dispatchJobResponseSchema = z.object({
  jobId: z.string().uuid(),
  workerId: z.string().uuid(),
  operation: dispatchableOperationSchema,
  status: jobStatusSchema,
  createdAt: z.string().datetime()
});
export type DispatchJobResponse = z.infer<typeof dispatchJobResponseSchema>;
