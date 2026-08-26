import {
  assetResponseSchema,
  errorResponseSchema,
  executionPlanResponseSchema,
  listAssetsResponseSchema,
  listExecutionPlanRevisionsResponseSchema,
  listProjectsResponseSchema,
  projectDtoSchema,
  projectResponseSchema,
  workMapResponseSchema,
  type AssetDto,
  type CreateProjectRequest,
  type ExecutionPlanEditOperation,
  type ExecutionPlanResponse,
  type ListExecutionPlanRevisionsResponse,
  type MediaKind,
  type ProjectDto,
  type ProjectResponse,
  type UpdateAssetRequest,
  type WorkMap,
  type WorkMapEntry
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
export async function createProject(body: CreateProjectRequest): Promise<ApiResult<ProjectDto>> {
  const { status, json } = await request("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (status !== 201) {
    return toErrorResult(status, json);
  }
  const parsed = projectDtoSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected project contract" };
  }
  return { ok: true, data: parsed.data };
}

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

/** GET the real Asset Catalog for a project - never another project's assets (enforced server-side, see find-owned-asset.ts). */
export async function fetchAssets(projectId: string): Promise<ApiResult<AssetDto[]>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/assets`);
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = listAssetsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected asset-list contract" };
  }
  return { ok: true, data: parsed.data.assets };
}

/**
 * Uploads a real file via multipart/form-data - never JSON-encoded, since
 * this is the client's actual bytes. `mediaKind` is only ever sent as the
 * optional LOGO override (see mime-allowlist.ts); every other kind is
 * derived server-side from the real sniffed MIME type.
 */
export async function uploadAsset(projectId: string, file: File, mediaKind?: MediaKind): Promise<ApiResult<AssetDto>> {
  const form = new FormData();
  form.append("file", file);
  if (mediaKind) {
    form.append("mediaKind", mediaKind);
  }
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", body: form });
  if (status !== 201) {
    return toErrorResult(status, json);
  }
  const parsed = assetResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected asset contract" };
  }
  return { ok: true, data: parsed.data.asset };
}

/** Only ever label/notes - every other asset fact is fixed at upload time. */
export async function updateAsset(projectId: string, assetId: string, body: UpdateAssetRequest): Promise<ApiResult<AssetDto>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = assetResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected asset contract" };
  }
  return { ok: true, data: parsed.data.asset };
}

/** The real API refuses this with 409 CONFLICT if the asset is still mapped to a scene in the current execution plan - surfaced to the caller as an ApiResult failure, never silently retried. */
export async function deleteAsset(projectId: string, assetId: string): Promise<ApiResult<true>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, {
    method: "DELETE"
  });
  if (status !== 204) {
    return toErrorResult(status, json);
  }
  return { ok: true, data: true };
}

/** Same-origin URL for an asset's real stored bytes - safe to use directly as an <img>/<video> src; never a filesystem path or storage key. */
export function assetFileUrl(projectId: string, assetId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/file`;
}

/** null (never a 404) is a real, valid state - no work map has been saved for this project yet. */
export async function fetchWorkMap(projectId: string): Promise<ApiResult<WorkMap | null>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/work-map`);
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = workMapResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected work-map contract" };
  }
  return { ok: true, data: parsed.data.workMap };
}

/** Replaces the whole entry list as one new revision - baseRevision 0 means "no work map exists yet, create the first one" (mirrors updateExecutionPlan's own optimistic-concurrency shape). */
export async function updateWorkMap(
  projectId: string,
  baseRevision: number,
  entries: Array<Omit<WorkMapEntry, "id"> & { id?: string }>
): Promise<ApiResult<WorkMap>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/work-map`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, entries })
  });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = workMapResponseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.workMap) {
    return { ok: false, status, code: null, message: "Response did not match the expected work-map contract" };
  }
  return { ok: true, data: parsed.data.workMap };
}
