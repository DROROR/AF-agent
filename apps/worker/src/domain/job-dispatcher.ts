import { validateJobPayload, type InspectTemplateRequest, type JobDto, type JobError } from "@dyo/schemas";
import { isAllowedOperation } from "./operation-allowlist.js";
import type { TemplateInspector } from "../inspection/template-inspector.js";

export interface JobExecutionResult {
  status: "SUCCEEDED" | "FAILED";
  result?: unknown;
  error?: JobError;
}

export interface JobDispatcherDeps {
  templateInspector: TemplateInspector;
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

  try {
    // Safe: payload was just validated against inspectTemplateRequestSchema
    // above via validateJobPayload, whose return type is `unknown` only
    // because it is generic across every operation's differently-shaped
    // schema.
    const response = await deps.templateInspector.inspect(payload as InspectTemplateRequest);
    return { status: "SUCCEEDED", result: response };
  } catch (cause) {
    // NotAvailableTemplateInspector always throws here today - the real
    // ae-mcp bridge protocol is still unconfirmed (see
    // docs/TEMPLATE-INSPECTOR.md). This is a real, typed, safe failure, not
    // a crash and not a fabricated success.
    return {
      status: "FAILED",
      error: {
        code: "NOT_AVAILABLE",
        message: cause instanceof Error ? cause.message : "INSPECT_TEMPLATE could not run"
      }
    };
  }
}
