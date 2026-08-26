import {
  validateJobPayload,
  type AeStatus,
  type CheckHealthResponse,
  type InspectTemplateRequest,
  type JobDto,
  type JobError,
  type McpStatus,
  type SceneEvidenceRequest
} from "@dyo/schemas";
import { isAllowedOperation } from "./operation-allowlist.js";
import type { TemplateInspector } from "../inspection/template-inspector.js";
import type { SceneEvidenceInspector } from "../inspection/scene-evidence-inspector.js";

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
  /** Checked before INSPECT_TEMPLATE/INSPECT_SCENE_EVIDENCE ever touch ae-mcp - see their precondition gates below. */
  getLatestHealth: () => LatestHealth | null;
  /** The one real CHECK_HEALTH implementation - see health/run-check-health-diagnostics.ts. Never gated on getLatestHealth(): diagnosing a bad AE/MCP status is this operation's whole purpose. */
  runCheckHealthDiagnostics: () => Promise<CheckHealthResponse>;
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
    // job-dispatcher owns job identity - the inspector itself is not
    // handed job/worker IDs, so a raw capture is stamped with them here,
    // right before it becomes the job's reported result.
    const stamped = response.kind === "raw_capture" ? { ...response, workerId: job.workerId, jobId: job.jobId } : response;
    return { status: "SUCCEEDED", result: stamped };
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
