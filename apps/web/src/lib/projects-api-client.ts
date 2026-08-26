import {
  errorResponseSchema,
  executionPlanResponseSchema,
  listExecutionPlanRevisionsResponseSchema,
  listProjectsResponseSchema,
  projectResponseSchema,
  type ExecutionPlanEditOperation,
  type ExecutionPlanResponse,
  type ListExecutionPlanRevisionsResponse,
  type ProjectDto,
  type ProjectResponse
} from "@dyo/schemas";

const REQUEST_TIMEOUT_MS = 8_000;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string | null; message: string };

/** status: 0 signals "request never reached the network" (timeout/offline) - distinct from any real HTTP status, and always handled as a failure by every caller below. Never throws - a network failure degrades to a typed result, same as fetchDashboardStatus's own safeFetch. */
async function request(path: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, { cache: "no-store", signal: controller.signal, ...init });
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, json };
  } catch {
    return { status: 0, json: null };
  } finally {
    clearTimeout(timeout);
  }
}

function toErrorResult(status: number, json: unknown): ApiResult<never> {
  if (status === 0) {
    return { ok: false, status, code: null, message: "Could not reach the server. Please try again." };
  }
  const parsedError = errorResponseSchema.safeParse(json);
  if (parsedError.success) {
    return { ok: false, status, code: parsedError.data.error.code, message: parsedError.data.error.message };
  }
  return { ok: false, status, code: null, message: `Request failed (${status})` };
}

/**
 * Every function here calls this app's OWN Next.js API routes
 * (src/app/api/projects/**), never the Fastify control-plane API directly
 * - see lib/server/api-proxy.ts. Every response is parsed through the
 * real @dyo/schemas contract; a response that doesn't match it is treated
 * as a failure rather than rendered as if it were valid data.
 */
export async function fetchProjectList(): Promise<ApiResult<ProjectDto[]>> {
  const { status, json } = await request("/api/projects");
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = listProjectsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected project-list contract" };
  }
  return { ok: true, data: parsed.data.projects };
}

export async function fetchProjectDetail(projectId: string): Promise<ApiResult<ProjectResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}`);
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = projectResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected project contract" };
  }
  return { ok: true, data: parsed.data };
}

export async function fetchExecutionPlan(projectId: string): Promise<ApiResult<ExecutionPlanResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/execution-plan`);
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = executionPlanResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected execution-plan contract" };
  }
  return { ok: true, data: parsed.data };
}

export async function fetchExecutionPlanRevisions(projectId: string): Promise<ApiResult<ListExecutionPlanRevisionsResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/revisions`);
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = listExecutionPlanRevisionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected revision-history contract" };
  }
  return { ok: true, data: parsed.data };
}

export async function updateExecutionPlan(
  projectId: string,
  baseRevision: number,
  operations: ExecutionPlanEditOperation[]
): Promise<ApiResult<ExecutionPlanResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/execution-plan`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, operations })
  });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = executionPlanResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected execution-plan contract" };
  }
  return { ok: true, data: parsed.data };
}

async function postPlanTransition(
  projectId: string,
  action: "approve" | "reject" | "reopen",
  baseRevision: number
): Promise<ApiResult<ExecutionPlanResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision })
  });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = executionPlanResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected execution-plan contract" };
  }
  return { ok: true, data: parsed.data };
}

export const approveExecutionPlan = (projectId: string, baseRevision: number): Promise<ApiResult<ExecutionPlanResponse>> =>
  postPlanTransition(projectId, "approve", baseRevision);
export const rejectExecutionPlan = (projectId: string, baseRevision: number): Promise<ApiResult<ExecutionPlanResponse>> =>
  postPlanTransition(projectId, "reject", baseRevision);
export const reopenExecutionPlan = (projectId: string, baseRevision: number): Promise<ApiResult<ExecutionPlanResponse>> =>
  postPlanTransition(projectId, "reopen", baseRevision);
