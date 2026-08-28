import {
  acceptMappingSuggestionResponseSchema,
  assetResponseSchema,
  batchAcceptMappingSuggestionsResponseSchema,
  errorResponseSchema,
  executionPlanResponseSchema,
  listAssetsResponseSchema,
  listExecutionPlanRevisionsResponseSchema,
  listMappingSuggestionsResponseSchema,
  listProjectsResponseSchema,
  projectDtoSchema,
  projectResponseSchema,
  rejectMappingSuggestionResponseSchema,
  workMapResponseSchema,
  type AcceptMappingSuggestionResponse,
  type AssetDto,
  type BatchAcceptMappingSuggestionsResponse,
  type CreateProjectRequest,
  type ExecutionPlanEditOperation,
  type ExecutionPlanResponse,
  type ListExecutionPlanRevisionsResponse,
  type ListMappingSuggestionsResponse,
  type MediaKind,
  type ProjectDto,
  type ProjectResponse,
  type RejectMappingSuggestionResponse,
  type UpdateAssetRequest,
  type WorkMap,
  type WorkMapEntry,
  listRenderArtifactsResponseSchema,
  dispatchJobResponseSchema,
  executionSessionResponseSchema,
  currentExecutionSessionResponseSchema,
  type RenderArtifactDto,
  type RenderOutputVariant,
  type SetRenderOutputConfigRequest,
  type DispatchJobRequest,
  type DispatchJobResponse,
  type ExecutionSessionDto
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

/** Runs deterministic evidence matching (and the AI provider, if configured) over every currently-unresolved mapping and persists the results as PENDING suggestions - never mutates the execution plan itself. */
export async function generateMappingSuggestions(projectId: string): Promise<ApiResult<ListMappingSuggestionsResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/generate`, { method: "POST" });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = listMappingSuggestionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected mapping-suggestions contract" };
  }
  return { ok: true, data: parsed.data };
}

export async function fetchMappingSuggestions(projectId: string): Promise<ApiResult<ListMappingSuggestionsResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions`);
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = listMappingSuggestionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected mapping-suggestions contract" };
  }
  return { ok: true, data: parsed.data };
}

/** Turns one PENDING suggestion into a real execution-plan edit via the exact same typed MAP_ASSET/SET_TEXT/... operations a human uses manually - never a second, less-validated write path. */
export async function acceptMappingSuggestion(
  projectId: string,
  suggestionId: string,
  baseRevision: number
): Promise<ApiResult<AcceptMappingSuggestionResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/${encodeURIComponent(suggestionId)}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision })
  });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = acceptMappingSuggestionResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected accept-suggestion contract" };
  }
  return { ok: true, data: parsed.data };
}

/** Leaves the execution plan completely untouched - reject is purely a review decision, never an edit. */
export async function rejectMappingSuggestion(projectId: string, suggestionId: string): Promise<ApiResult<RejectMappingSuggestionResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/${encodeURIComponent(suggestionId)}/reject`, {
    method: "POST"
  });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = rejectMappingSuggestionResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected reject-suggestion contract" };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Explicit render-output configuration (render-delivery phase section
 * 1/2) - only `manifestCompositionId` (from a real manifest composition)
 * plus the two template name fields are ever sent; the server resolves
 * aeProjectItemIndex/compositionName itself (see set-render-output-config.ts).
 */
export async function setRenderOutputConfig(
  projectId: string,
  variant: RenderOutputVariant,
  body: SetRenderOutputConfigRequest
): Promise<ApiResult<ExecutionPlanResponse>> {
  const { status, json } = await request(
    `/api/projects/${encodeURIComponent(projectId)}/execution-plan/render-outputs/${encodeURIComponent(variant)}`,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = executionPlanResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected execution-plan contract" };
  }
  return { ok: true, data: parsed.data };
}

/** Real, persisted render-result metadata (render-delivery phase section 7/12) - only genuinely completed/validated artifacts, never a placeholder/fake card. */
export async function fetchRenderArtifacts(projectId: string): Promise<ApiResult<RenderArtifactDto[]>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/render-artifacts`);
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = listRenderArtifactsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected render-artifact list contract" };
  }
  return { ok: true, data: parsed.data.artifacts };
}

/** Same-origin URL for a render artifact's real stored bytes - safe to use directly as a download link; never a filesystem path or storage key. */
export function renderArtifactFileUrl(projectId: string, artifactId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/render-artifacts/${encodeURIComponent(artifactId)}/file`;
}

/**
 * Real job dispatch (activation-phase section 6) - the ONE call that turns
 * a dashboard action into a real queued job. `request` is always one of
 * the narrow, allowlisted DispatchJobRequest shapes (never a generic
 * payload) - for EXECUTE_FRAME/RENDER this is only a minimal intent
 * (workerId/projectId/scenePlanId or variant); the server resolves the
 * entire real worker payload itself (see dispatch-job.ts).
 */
export async function dispatchJob(dispatchRequest: DispatchJobRequest): Promise<ApiResult<DispatchJobResponse>> {
  const { status, json } = await request(`/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dispatchRequest)
  });
  if (status !== 201) {
    return toErrorResult(status, json);
  }
  const parsed = dispatchJobResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected job-dispatch contract" };
  }
  return { ok: true, data: parsed.data };
}

/**
 * "Start Execution" (multi-scene-accumulation phase, section 14) - idempotent:
 * returns the existing active session unchanged if one already exists for
 * the project's current plan revision (create-execution-session.ts), never
 * creates a duplicate. `workerId` is only ever consulted the FIRST time a
 * session is created - every later scene-edit/render dispatch is pinned to
 * whichever worker the session actually ended up with (worker affinity).
 */
export async function createExecutionSession(projectId: string, workerId: string): Promise<ApiResult<ExecutionSessionDto>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId })
  });
  if (status !== 201) {
    return toErrorResult(status, json);
  }
  const parsed = executionSessionResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected execution-session contract" };
  }
  return { ok: true, data: parsed.data.session };
}

/** The active execution session for this project's current plan, or null - see get-current-execution-session.ts. */
export async function fetchCurrentExecutionSession(projectId: string): Promise<ApiResult<ExecutionSessionDto | null>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions/current`);
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = currentExecutionSessionResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected execution-session contract" };
  }
  return { ok: true, data: parsed.data.session };
}

/** "Approve Preview" (section 10) - the one human gate between a session's first completed scene and every scene after it. */
export async function approveFirstPreview(projectId: string, sessionId: string): Promise<ApiResult<ExecutionSessionDto>> {
  const { status, json } = await request(
    `/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/approve-preview`,
    { method: "POST" }
  );
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = executionSessionResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected execution-session contract" };
  }
  return { ok: true, data: parsed.data.session };
}

/** "Reject Preview" (section 3/10) - the other half of the human preview gate. Marks the session FAILED (terminal); a corrected mapping/plan starts a NEW session. */
export async function rejectFirstPreview(projectId: string, sessionId: string): Promise<ApiResult<ExecutionSessionDto>> {
  const { status, json } = await request(
    `/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/reject-preview`,
    { method: "POST" }
  );
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = executionSessionResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected execution-session contract" };
  }
  return { ok: true, data: parsed.data.session };
}

/** Same-origin URL for a session's current preview PNG - safe to use directly as an <img> src; never a filesystem path or storage key. */
export function executionSessionPreviewUrl(projectId: string, sessionId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/preview`;
}

/** Accepts several PENDING suggestions as one batched plan revision bump - never partial (see batch-accept-mapping-suggestions.ts). */
export async function batchAcceptMappingSuggestions(
  projectId: string,
  suggestionIds: string[],
  baseRevision: number
): Promise<ApiResult<BatchAcceptMappingSuggestionsResponse>> {
  const { status, json } = await request(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/accept-batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, suggestionIds })
  });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = batchAcceptMappingSuggestionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected batch-accept contract" };
  }
  return { ok: true, data: parsed.data };
}
