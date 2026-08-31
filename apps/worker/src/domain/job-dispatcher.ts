import {
  validateJobPayload,
  type AeStatus,
  type CheckHealthResponse,
  type CreateFullPreviewRequest,
  type ExecuteSceneEditRequest,
  type InspectTemplateRequest,
  type JobDto,
  type JobError,
  type McpStatus,
  type RenderProjectRequest,
  type SceneEvidenceRequest
} from "@dyo/schemas";
import { isAllowedOperation } from "./operation-allowlist.js";
import type { TemplateInspector } from "../inspection/template-inspector.js";
import type { SceneEvidenceInspector } from "../inspection/scene-evidence-inspector.js";
import { executeSceneEdit, type PersistCheckpoint } from "../execution/execute-scene-edit-executor.js";
import type { AeEditBridge } from "../execution/ae-edit-bridge.js";
import type { PreviewCapture } from "../execution/preview-capture.js";
import type { PreviewUploader } from "../execution/upload-preview.js";
import { resolveSceneEditOperation } from "../execution/resolve-scene-edit-operation.js";
import type { AssetDownloadClient } from "../workspace/asset-cache.js";
import { executeRenderProject } from "../execution/render/render-project-executor.js";
import type { AerenderRunner } from "../execution/render/aerender-runner.js";
import type { CompositionVerifier } from "../execution/render/verify-render-composition.js";
import type { RenderArtifactUploader } from "../execution/render/upload-render-artifact.js";
import type { RenderCapabilitiesInspector } from "../execution/render/inspect-render-capabilities.js";
import { executeCreateFullPreview } from "../execution/preview/create-full-preview-executor.js";
import type { FullPreviewUploader } from "../execution/preview/upload-full-preview.js";
import type { SceneEvidencePreviewUploader } from "../inspection/upload-scene-evidence-preview.js";

export interface JobExecutionResult {
  status: "SUCCEEDED" | "FAILED";
  result?: unknown;
  error?: JobError;
}

/** The most recently server-confirmed AE/MCP health, or null before the first successful heartbeat - see index.ts. */
export interface LatestHealth {
  aeStatus: AeStatus;
  mcpStatus: McpStatus;
}

export interface JobDispatcherDeps {
  templateInspector: TemplateInspector;
  sceneEvidenceInspector: SceneEvidenceInspector;
  /** Checked before INSPECT_TEMPLATE/INSPECT_SCENE_EVIDENCE/EXECUTE_FRAME ever touch ae-mcp - see their precondition gates below. */
  getLatestHealth: () => LatestHealth | null;
  /** The one real CHECK_HEALTH implementation - see health/run-check-health-diagnostics.ts. Never gated on getLatestHealth(): diagnosing a bad AE/MCP status is this operation's whole purpose. */
  runCheckHealthDiagnostics: () => Promise<CheckHealthResponse>;
  /** EXECUTE_FRAME's real (or honest-stub) mutation bridge and preview capture - see execution/execute-scene-edit-executor.ts. */
  aeEditBridge: AeEditBridge;
  previewCapture: PreviewCapture;
  /** Multi-scene-accumulation phase, section 3: the real worker->API preview byte transfer - see execution/upload-preview.ts. */
  previewUploader: PreviewUploader;
  /** INSPECT_SCENE_EVIDENCE's own preview-frame upload - see inspection/upload-scene-evidence-preview.ts. */
  sceneEvidencePreviewUploader: SceneEvidencePreviewUploader;
  /** EXECUTE_FRAME's durable mid-job checkpoint reporter - see execute-scene-edit-executor.ts's PersistCheckpoint. Reused unchanged by RENDER (see render-project.ts's own doc comment on the shared checkpoint shape). */
  persistCheckpoint: PersistCheckpoint;
  /** MAP_FOOTAGE's asset-delivery dependency - see workspace/asset-cache.ts/execution/resolve-scene-edit-operation.ts. */
  assetDownloadClient: AssetDownloadClient;
  /** RENDER's own dependencies - see execution/render/render-project-executor.ts. aerenderPath mirrors env.aerenderPath (AERENDER_PATH) - never a caller-supplied path. */
  aerenderPath: string | undefined;
  aerenderRunner: AerenderRunner;
  compositionVerifier: CompositionVerifier;
  artifactUploader: RenderArtifactUploader;
  /** INSPECT_RENDER_CAPABILITIES's own dependency - see execution/render/inspect-render-capabilities.ts. */
  renderCapabilitiesInspector: RenderCapabilitiesInspector;
  /** CREATE_PREVIEW's own dependency - see execution/preview/upload-full-preview.ts. Reuses aerenderPath/aerenderRunner/compositionVerifier above, same as RENDER. */
  fullPreviewUploader: FullPreviewUploader;
  workRoot: string;
  now: () => Date;
}

/**
 * Executes exactly one claimed job by dispatching on its operation - never
 * an arbitrary command, never a caller-supplied executable path. Every
 * branch is a fixed, named handler; an operation with no handler here
 * fails safely (UNSUPPORTED_OPERATION) rather than being attempted. The
 * job's payload is re-validated against its operation's own schema here,
 * independently of the API's own validation at job-creation time (defense
 * in depth across the API/worker boundary).
 */
export async function executeJob(deps: JobDispatcherDeps, job: JobDto): Promise<JobExecutionResult> {
  if (!isAllowedOperation(job.operation)) {
    return {
      status: "FAILED",
      error: { code: "UNSUPPORTED_OPERATION", message: `Operation "${job.operation}" is not recognized` }
    };
  }

  switch (job.operation) {
    case "INSPECT_TEMPLATE":
      return runInspectTemplate(deps, job);
    case "CHECK_HEALTH":
      return runCheckHealth(deps, job);
    case "INSPECT_SCENE_EVIDENCE":
      return runInspectSceneEvidence(deps, job);
    case "EXECUTE_FRAME":
      return runExecuteFrame(deps, job);
    case "RENDER":
      return runRenderProject(deps, job);
    case "INSPECT_RENDER_CAPABILITIES":
      return runInspectRenderCapabilities(deps, job);
    case "CREATE_PREVIEW":
      return runCreateFullPreview(deps, job);
    default:
      // Every other WORKER_CAPABILITIES entry is a recognized operation
      // name with no execution handler yet - fail safely, never attempt it.
      return {
        status: "FAILED",
        error: {
          code: "UNSUPPORTED_OPERATION",
          message: `Operation "${job.operation}" is recognized but has no execution handler yet`
        }
      };
  }
}

async function runInspectTemplate(deps: JobDispatcherDeps, job: JobDto): Promise<JobExecutionResult> {
  // Structurally guaranteed by the switch above (this function is only
  // ever reached from the INSPECT_TEMPLATE case) - asserted explicitly
  // anyway, matching this codebase's existing defense-in-depth style (the
  // payload is also re-validated below, independently of the API's own
  // validation at job-creation time).
  if (job.operation !== "INSPECT_TEMPLATE") {
    return {
      status: "FAILED",
      error: { code: "INTERNAL_ERROR", message: "runInspectTemplate called for a non-INSPECT_TEMPLATE job" }
    };
  }

  let payload: unknown;
  try {
    payload = validateJobPayload("INSPECT_TEMPLATE", job.payload);
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "INVALID_PAYLOAD",
        message: cause instanceof Error ? cause.message : "INSPECT_TEMPLATE payload failed validation"
      }
    };
  }

  // Safety gate: never let INSPECT_TEMPLATE touch ae-mcp unless AE and MCP
  // were BOTH confirmed ONLINE as of the most recent server-round-tripped
  // heartbeat. A typed FAILED/PRECONDITION_NOT_MET result (rather than
  // WAITING_FOR_ACTION) is used deliberately: nothing in this job's
  // lifecycle currently defines how a WAITING_FOR_ACTION job would ever
  // resume automatically once AE/MCP come back online, and inventing that
  // semantics here - rather than reusing an already-proven mechanism -
  // would be exactly the kind of unverified guess this project has
  // explicitly moved away from. A fresh job can simply be dispatched again
  // once health is confirmed.
  const health = deps.getLatestHealth();
  if (!health || health.aeStatus !== "ONLINE" || health.mcpStatus !== "ONLINE") {
    return {
      status: "FAILED",
      error: {
        code: "PRECONDITION_NOT_MET",
        message: health
          ? `AE and MCP must both be ONLINE (aeStatus=${health.aeStatus}, mcpStatus=${health.mcpStatus})`
          : "No heartbeat has succeeded yet - AE/MCP status is not yet confirmed"
      }
    };
  }

  try {
    // Safe: payload was just validated against inspectTemplateRequestSchema
    // above via validateJobPayload, whose return type is `unknown` only
    // because it is generic across every operation's differently-shaped
    // schema.
    const response = await deps.templateInspector.inspect(payload as InspectTemplateRequest);
    if (response.kind === "raw_capture") {
      // A RawInspectionCapture explicitly means a real TemplateManifest
      // could not honestly be built (see template-inspector.ts's own doc
      // comment on RawInspectionCapture) - it must never be reported as a
      // successful template inspection, even though inspection itself ran
      // to completion without throwing. job-dispatcher owns job identity -
      // the inspector itself is not handed job/worker IDs, so the capture
      // is stamped with them here, right before it becomes the job's
      // reported (failed) result, preserved for troubleshooting.
      const stamped = { ...response, workerId: job.workerId, jobId: job.jobId };
      return {
        status: "FAILED",
        error: { code: "MANIFEST_NOT_BUILT", message: "Template inspection could not produce a valid manifest." },
        result: stamped
      };
    }
    return { status: "SUCCEEDED", result: response };
  } catch (cause) {
    // NotAvailableTemplateInspector (no longer used in the real worker
    // execution path - see index.ts) always throws here; a real
    // HeroicSwanTemplateInspector should not, but this remains a real,
    // typed, safe failure rather than a crash if it ever does.
    return {
      status: "FAILED",
      error: {
        code: "NOT_AVAILABLE",
        message: cause instanceof Error ? cause.message : "INSPECT_TEMPLATE could not run"
      }
    };
  }
}

async function runInspectSceneEvidence(deps: JobDispatcherDeps, job: JobDto): Promise<JobExecutionResult> {
  if (job.operation !== "INSPECT_SCENE_EVIDENCE") {
    return {
      status: "FAILED",
      error: { code: "INTERNAL_ERROR", message: "runInspectSceneEvidence called for a non-INSPECT_SCENE_EVIDENCE job" }
    };
  }

  let payload: unknown;
  try {
    payload = validateJobPayload("INSPECT_SCENE_EVIDENCE", job.payload);
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "INVALID_PAYLOAD",
        message: cause instanceof Error ? cause.message : "INSPECT_SCENE_EVIDENCE payload failed validation"
      }
    };
  }

  // Same safety gate as runInspectTemplate above: this touches ae-mcp, so
  // it never runs unless AE and MCP were BOTH confirmed ONLINE as of the
  // most recent server-round-tripped heartbeat.
  const health = deps.getLatestHealth();
  if (!health || health.aeStatus !== "ONLINE" || health.mcpStatus !== "ONLINE") {
    return {
      status: "FAILED",
      error: {
        code: "PRECONDITION_NOT_MET",
        message: health
          ? `AE and MCP must both be ONLINE (aeStatus=${health.aeStatus}, mcpStatus=${health.mcpStatus})`
          : "No heartbeat has succeeded yet - AE/MCP status is not yet confirmed"
      }
    };
  }

  try {
    const result = await deps.sceneEvidenceInspector.inspect(payload as SceneEvidenceRequest);
    if (result.kind === "failure") {
      return { status: "FAILED", error: { code: "NOT_AVAILABLE", message: result.reason } };
    }
    // Client-facing UX redesign, "M. VISUAL PREVIEWS ARE MANDATORY": a
    // captured preview frame's bytes are uploaded to the API's durable
    // storage - best-effort, exactly like the capture step itself (see
    // SceneEvidenceResponse.preview's own doc comment: "a failed preview
    // never fails the whole evidence result"). An upload failure here is
    // never surfaced as a job failure - the structural layer facts this
    // job exists to report remain valid and useful either way.
    if (result.response.preview) {
      await deps.sceneEvidencePreviewUploader.upload({ jobId: job.jobId, filePath: result.response.preview.path });
    }
    return { status: "SUCCEEDED", result: result.response };
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "NOT_AVAILABLE",
        message: cause instanceof Error ? cause.message : "INSPECT_SCENE_EVIDENCE could not run"
      }
    };
  }
}

async function runExecuteFrame(deps: JobDispatcherDeps, job: JobDto): Promise<JobExecutionResult> {
  if (job.operation !== "EXECUTE_FRAME") {
    return {
      status: "FAILED",
      error: { code: "INTERNAL_ERROR", message: "runExecuteFrame called for a non-EXECUTE_FRAME job" }
    };
  }

  let payload: unknown;
  try {
    payload = validateJobPayload("EXECUTE_FRAME", job.payload);
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "INVALID_PAYLOAD",
        message: cause instanceof Error ? cause.message : "EXECUTE_FRAME payload failed validation"
      }
    };
  }

  // Same safety gate as runInspectTemplate/runInspectSceneEvidence: never
  // let EXECUTE_FRAME touch ae-mcp unless AE and MCP were BOTH confirmed
  // ONLINE as of the most recent server-round-tripped heartbeat.
  const health = deps.getLatestHealth();
  if (!health || health.aeStatus !== "ONLINE" || health.mcpStatus !== "ONLINE") {
    return {
      status: "FAILED",
      error: {
        code: "PRECONDITION_NOT_MET",
        message: health
          ? `AE and MCP must both be ONLINE (aeStatus=${health.aeStatus}, mcpStatus=${health.mcpStatus})`
          : "No heartbeat has succeeded yet - AE/MCP status is not yet confirmed"
      }
    };
  }

  try {
    const result = await executeSceneEdit(
      {
        workRoot: deps.workRoot,
        aeEditBridge: deps.aeEditBridge,
        previewCapture: deps.previewCapture,
        uploadPreview: (filePath) => deps.previewUploader.upload({ jobId: job.jobId, filePath }),
        persistCheckpoint: deps.persistCheckpoint,
        resolveOperation: (intent) =>
          resolveSceneEditOperation({ workRoot: deps.workRoot, jobId: job.jobId, assetDownloadClient: deps.assetDownloadClient }, intent),
        now: deps.now
      },
      payload as ExecuteSceneEditRequest
    );
    // job-dispatcher owns job identity - the executor itself is not
    // handed job/worker IDs, matching the same stamping convention
    // runInspectTemplate already uses for raw captures.
    const stamped = { ...result, workerId: job.workerId, jobId: job.jobId };
    if (result.failureReason !== null) {
      // A recoverable/typed failure - the checkpoint carried in `result`
      // already preserves whatever operations genuinely completed, so a
      // later job attempt with this same checkpoint resumes correctly.
      // Still reported as a job-level FAILED (never SUCCEEDED with a
      // failureReason set) so nothing downstream mistakes this for done.
      return { status: "FAILED", result: stamped, error: { code: "NOT_AVAILABLE", message: result.failureReason } };
    }
    return { status: "SUCCEEDED", result: stamped };
  } catch (cause) {
    // NotAvailableAeEditBridge/NotAvailablePreviewCapture always throw
    // here; a real HeroicSwanAeEditBridge/HeroicSwanPreviewCapture should
    // not (they report typed failures instead), but this remains a real,
    // safe failure rather than a crash if either ever does.
    return {
      status: "FAILED",
      error: {
        code: "NOT_AVAILABLE",
        message: cause instanceof Error ? cause.message : "EXECUTE_FRAME could not run"
      }
    };
  }
}

async function runRenderProject(deps: JobDispatcherDeps, job: JobDto): Promise<JobExecutionResult> {
  if (job.operation !== "RENDER") {
    return {
      status: "FAILED",
      error: { code: "INTERNAL_ERROR", message: "runRenderProject called for a non-RENDER job" }
    };
  }

  let payload: unknown;
  try {
    payload = validateJobPayload("RENDER", job.payload);
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "INVALID_PAYLOAD",
        message: cause instanceof Error ? cause.message : "RENDER payload failed validation"
      }
    };
  }

  // Same safety gate as EXECUTE_FRAME: VERIFY_COMPOSITION touches ae-mcp
  // (against a live AfterFX.exe instance), so this never runs unless AE and
  // MCP were BOTH confirmed ONLINE as of the most recent heartbeat - even
  // though the later RUN_AERENDER stage itself launches a separate,
  // headless aerender process that does not require an interactive AE
  // session.
  const health = deps.getLatestHealth();
  if (!health || health.aeStatus !== "ONLINE" || health.mcpStatus !== "ONLINE") {
    return {
      status: "FAILED",
      error: {
        code: "PRECONDITION_NOT_MET",
        message: health
          ? `AE and MCP must both be ONLINE (aeStatus=${health.aeStatus}, mcpStatus=${health.mcpStatus})`
          : "No heartbeat has succeeded yet - AE/MCP status is not yet confirmed"
      }
    };
  }

  try {
    const result = await executeRenderProject(
      {
        workRoot: deps.workRoot,
        aerenderPath: deps.aerenderPath,
        aerenderRunner: deps.aerenderRunner,
        compositionVerifier: deps.compositionVerifier,
        artifactUploader: deps.artifactUploader,
        persistCheckpoint: deps.persistCheckpoint,
        now: deps.now
      },
      job.jobId,
      payload as RenderProjectRequest
    );
    // job-dispatcher owns job identity - the executor itself is not handed
    // job/worker IDs, matching runExecuteFrame's own stamping convention.
    const stamped = { ...result, workerId: job.workerId, jobId: job.jobId };
    if (result.failureReason !== null) {
      return { status: "FAILED", result: stamped, error: { code: "NOT_AVAILABLE", message: result.failureReason } };
    }
    return { status: "SUCCEEDED", result: stamped };
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "NOT_AVAILABLE",
        message: cause instanceof Error ? cause.message : "RENDER could not run"
      }
    };
  }
}

async function runCreateFullPreview(deps: JobDispatcherDeps, job: JobDto): Promise<JobExecutionResult> {
  if (job.operation !== "CREATE_PREVIEW") {
    return {
      status: "FAILED",
      error: { code: "INTERNAL_ERROR", message: "runCreateFullPreview called for a non-CREATE_PREVIEW job" }
    };
  }

  let payload: unknown;
  try {
    payload = validateJobPayload("CREATE_PREVIEW", job.payload);
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "INVALID_PAYLOAD",
        message: cause instanceof Error ? cause.message : "CREATE_PREVIEW payload failed validation"
      }
    };
  }

  // Same safety gate as RENDER: VERIFY_COMPOSITION touches ae-mcp (against
  // a live AfterFX.exe instance), so this never runs unless AE and MCP
  // were BOTH confirmed ONLINE as of the most recent heartbeat.
  const health = deps.getLatestHealth();
  if (!health || health.aeStatus !== "ONLINE" || health.mcpStatus !== "ONLINE") {
    return {
      status: "FAILED",
      error: {
        code: "PRECONDITION_NOT_MET",
        message: health
          ? `AE and MCP must both be ONLINE (aeStatus=${health.aeStatus}, mcpStatus=${health.mcpStatus})`
          : "No heartbeat has succeeded yet - AE/MCP status is not yet confirmed"
      }
    };
  }

  try {
    const result = await executeCreateFullPreview(
      {
        workRoot: deps.workRoot,
        aerenderPath: deps.aerenderPath,
        aerenderRunner: deps.aerenderRunner,
        compositionVerifier: deps.compositionVerifier,
        fullPreviewUploader: deps.fullPreviewUploader,
        now: deps.now
      },
      job.jobId,
      payload as CreateFullPreviewRequest
    );
    // job-dispatcher owns job identity - the executor itself is not handed
    // job/worker IDs, matching runExecuteFrame/runRenderProject's own
    // stamping convention.
    const stamped = { ...result, workerId: job.workerId, jobId: job.jobId };
    if (result.failureReason !== null) {
      return { status: "FAILED", result: stamped, error: { code: "NOT_AVAILABLE", message: result.failureReason } };
    }
    return { status: "SUCCEEDED", result: stamped };
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "NOT_AVAILABLE",
        message: cause instanceof Error ? cause.message : "CREATE_PREVIEW could not run"
      }
    };
  }
}

async function runInspectRenderCapabilities(deps: JobDispatcherDeps, job: JobDto): Promise<JobExecutionResult> {
  if (job.operation !== "INSPECT_RENDER_CAPABILITIES") {
    return {
      status: "FAILED",
      error: { code: "INTERNAL_ERROR", message: "runInspectRenderCapabilities called for a non-INSPECT_RENDER_CAPABILITIES job" }
    };
  }

  try {
    validateJobPayload("INSPECT_RENDER_CAPABILITIES", job.payload);
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "INVALID_PAYLOAD",
        message: cause instanceof Error ? cause.message : "INSPECT_RENDER_CAPABILITIES payload failed validation"
      }
    };
  }

  // Same safety gate as every other operation that touches ae-mcp.
  const health = deps.getLatestHealth();
  if (!health || health.aeStatus !== "ONLINE" || health.mcpStatus !== "ONLINE") {
    return {
      status: "FAILED",
      error: {
        code: "PRECONDITION_NOT_MET",
        message: health
          ? `AE and MCP must both be ONLINE (aeStatus=${health.aeStatus}, mcpStatus=${health.mcpStatus})`
          : "No heartbeat has succeeded yet - AE/MCP status is not yet confirmed"
      }
    };
  }

  try {
    const result = await deps.renderCapabilitiesInspector.inspect();
    if (result.kind === "failure") {
      return { status: "FAILED", error: { code: "NOT_AVAILABLE", message: result.reason } };
    }
    return { status: "SUCCEEDED", result: result.response };
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "NOT_AVAILABLE",
        message: cause instanceof Error ? cause.message : "INSPECT_RENDER_CAPABILITIES could not run"
      }
    };
  }
}

async function runCheckHealth(deps: JobDispatcherDeps, job: JobDto): Promise<JobExecutionResult> {
  // Structurally guaranteed by the switch above - asserted anyway, matching
  // runInspectTemplate's own defense-in-depth style.
  if (job.operation !== "CHECK_HEALTH") {
    return {
      status: "FAILED",
      error: { code: "INTERNAL_ERROR", message: "runCheckHealth called for a non-CHECK_HEALTH job" }
    };
  }

  try {
    validateJobPayload("CHECK_HEALTH", job.payload);
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "INVALID_PAYLOAD",
        message: cause instanceof Error ? cause.message : "CHECK_HEALTH payload failed validation"
      }
    };
  }

  // Deliberately NOT gated on getLatestHealth() (unlike runInspectTemplate
  // above) - CHECK_HEALTH exists specifically to diagnose a bad/disagreeing
  // AE or MCP status, so requiring either to already be ONLINE would make
  // it useless exactly when it is needed most.
  try {
    const response = await deps.runCheckHealthDiagnostics();
    return { status: "SUCCEEDED", result: response };
  } catch (cause) {
    return {
      status: "FAILED",
      error: {
        code: "INTERNAL_ERROR",
        message: cause instanceof Error ? cause.message : "CHECK_HEALTH could not run"
      }
    };
  }
}
