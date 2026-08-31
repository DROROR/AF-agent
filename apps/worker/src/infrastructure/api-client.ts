import {
  claimJobResponseSchema,
  fullPreviewUploadResponseSchema,
  jobDtoSchema,
  previewUploadResponseSchema,
  registerWorkerResponseSchema,
  renderArtifactUploadResponseSchema,
  workerDtoSchema,
  type ClaimJobResponse,
  type FullPreviewUploadResponse,
  type HeartbeatRequest,
  type JobDto,
  type PreviewUploadResponse,
  type RegisterWorkerRequest,
  type RegisterWorkerResponse,
  type RenderArtifactUploadResponse,
  type RenderOutputVariant,
  type ReportJobStatusRequest,
  type WorkerDto
} from "@dyo/schemas";
import { ApiResponseError, NetworkError, UnauthorizedApiError } from "../errors/worker-error.js";

const REQUEST_TIMEOUT_MS = 10_000;
// A real rendered video can legitimately take a long time to transfer over
// the worker's real outbound connection - this only guards against a truly
// hung upload, not a slow-but-progressing one (mirrors aerender-runner.ts's
// own "generous timeout, real guard against a hang" rationale).
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

export interface ApiClientConfig {
  apiUrl: string;
  fetchImpl?: typeof fetch;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Thin HTTP boundary to the Contabo API. Never logs the bearer token it
 * sends - see docs/engineering/OBSERVABILITY.md ("never log secrets"). All
 * failures are translated into the typed worker error hierarchy so callers
 * (the heartbeat loop) never see a raw fetch/DOMException.
 */
export class ApiClient {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ApiClientConfig) {
    this.apiUrl = config.apiUrl;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async registerWorker(
    registrationSecret: string,
    body: RegisterWorkerRequest
  ): Promise<RegisterWorkerResponse> {
    const response = await this.request("POST", "/api/workers/register", registrationSecret, body);
    const json = await parseJson(response);
    if (response.status === 201) {
      return registerWorkerResponseSchema.parse(json);
    }
    throw this.errorForResponse(response, json);
  }

  async sendHeartbeat(
    workerId: string,
    workerToken: string,
    body: HeartbeatRequest
  ): Promise<WorkerDto> {
    const response = await this.request(
      "POST",
      `/api/workers/${workerId}/heartbeat`,
      workerToken,
      body
    );
    const json = await parseJson(response);
    if (response.status === 200) {
      return workerDtoSchema.parse(json);
    }
    throw this.errorForResponse(response, json);
  }

  /** Asks for this worker's own next queued job. `job: null` means nothing to claim right now - not an error. */
  async claimNextJob(workerId: string, workerToken: string): Promise<ClaimJobResponse> {
    const response = await this.request("POST", `/api/workers/${workerId}/jobs/claim`, workerToken, {});
    const json = await parseJson(response);
    if (response.status === 200) {
      return claimJobResponseSchema.parse(json);
    }
    throw this.errorForResponse(response, json);
  }

  async reportJobStatus(
    workerId: string,
    workerToken: string,
    jobId: string,
    body: ReportJobStatusRequest
  ): Promise<JobDto> {
    const response = await this.request(
      "POST",
      `/api/workers/${workerId}/jobs/${jobId}/report`,
      workerToken,
      body
    );
    const json = await parseJson(response);
    if (response.status === 200) {
      return jobDtoSchema.parse(json);
    }
    throw this.errorForResponse(response, json);
  }

  /**
   * Durable MID-JOB progress report - see apps/api's report-job-checkpoint.ts
   * for the full contract this hits. Never a status transition: this can
   * fail (job no longer RUNNING, checkpoint regression, wrong worker) and
   * callers must treat that as "checkpoint state unknown" - see
   * execute-scene-edit-executor.ts's own handling.
   */
  async reportCheckpoint(
    workerId: string,
    workerToken: string,
    jobId: string,
    checkpoint: unknown
  ): Promise<JobDto> {
    const response = await this.request(
      "POST",
      `/api/workers/${workerId}/jobs/${jobId}/checkpoint`,
      workerToken,
      { checkpoint }
    );
    const json = await parseJson(response);
    if (response.status === 200) {
      return jobDtoSchema.parse(json);
    }
    throw this.errorForResponse(response, json);
  }

  /**
   * Downloads one project asset's real bytes (activation-phase Gap 2:
   * asset delivery to the worker), bound to this worker's OWN currently-
   * assigned job - a plain authenticated GET, never a JSON body in
   * either direction. The API independently verifies job/project
   * ownership before ever returning bytes (see get-asset-file-for-worker.ts) -
   * this method itself never claims the returned bytes are correct; the
   * caller (workspace/asset-cache.ts) always re-verifies them against its
   * own expected sha256 before use.
   */
  async downloadAsset(workerId: string, workerToken: string, jobId: string, assetId: string): Promise<Buffer> {
    const path = `/api/workers/${workerId}/jobs/${jobId}/assets/${assetId}/file`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${workerToken}` }
      });
    } catch (cause) {
      throw new NetworkError(`Failed to reach ${path}`, { cause });
    }
    if (response.status !== 200) {
      const json = await parseJson(response);
      throw this.errorForResponse(response, json);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Uploads the real rendered output bytes (render-delivery phase section
   * 4) - a separate, multipart request, never the JSON `request()` helper
   * below. Reads the whole file into memory as one Buffer (an accepted
   * simplification for real render outputs, which are far under typical
   * worker RAM - not a true streamed upload; see this repo's own
   * render-artifact-upload.integration.test.ts for the server side, which
   * DOES stream-parse the incoming multipart body). Idempotent/retry-safe
   * on the server side by content hash (see upload-render-artifact.ts) -
   * safe to call again after a network failure here.
   */
  async uploadRenderArtifact(
    workerId: string,
    workerToken: string,
    jobId: string,
    variant: RenderOutputVariant,
    fileBuffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<RenderArtifactUploadResponse> {
    const form = new FormData();
    form.append("variant", variant);
    form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    const path = `/api/workers/${workerId}/jobs/${jobId}/artifact`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${workerToken}` },
        body: form,
        signal: controller.signal
      });
    } catch (cause) {
      throw new NetworkError(`Failed to reach ${path}`, { cause });
    } finally {
      clearTimeout(timeout);
    }

    const json = await parseJson(response);
    if (response.status === 201) {
      return renderArtifactUploadResponseSchema.parse(json);
    }
    throw this.errorForResponse(response, json);
  }

  /**
   * Worker->API preview byte transfer (multi-scene-accumulation phase,
   * section 3) - the ONE place a real captured preview's bytes ever leave
   * this worker machine. Mirrors uploadRenderArtifact's own shape exactly
   * (multipart form, worker-authenticated, generous upload timeout).
   */
  async uploadPreview(workerId: string, workerToken: string, jobId: string, fileBuffer: Buffer, filename: string, mimeType: string): Promise<PreviewUploadResponse> {
    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    const path = `/api/workers/${workerId}/jobs/${jobId}/preview`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${workerToken}` },
        body: form,
        signal: controller.signal
      });
    } catch (cause) {
      throw new NetworkError(`Failed to reach ${path}`, { cause });
    } finally {
      clearTimeout(timeout);
    }

    const json = await parseJson(response);
    if (response.status === 201) {
      return previewUploadResponseSchema.parse(json);
    }
    throw this.errorForResponse(response, json);
  }

  /**
   * Worker->API complete-preview byte transfer (client-handoff completion
   * phase, section T) - the ONE place a real CREATE_PREVIEW output's
   * bytes ever leave this worker machine. Mirrors uploadRenderArtifact's
   * own shape exactly (multipart form, worker-authenticated, generous
   * upload timeout), minus `variant` (a full preview is not
   * LANDSCAPE/REELS - just one preview per session).
   */
  async uploadFullPreview(workerId: string, workerToken: string, jobId: string, fileBuffer: Buffer, filename: string, mimeType: string): Promise<FullPreviewUploadResponse> {
    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    const path = `/api/workers/${workerId}/jobs/${jobId}/full-preview`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${workerToken}` },
        body: form,
        signal: controller.signal
      });
    } catch (cause) {
      throw new NetworkError(`Failed to reach ${path}`, { cause });
    } finally {
      clearTimeout(timeout);
    }

    const json = await parseJson(response);
    if (response.status === 201) {
      return fullPreviewUploadResponseSchema.parse(json);
    }
    throw this.errorForResponse(response, json);
  }

  private async request(
    method: "POST",
    path: string,
    bearerToken: string,
    body: unknown
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(`${this.apiUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearerToken}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (cause) {
      throw new NetworkError(`Failed to reach ${path}`, { cause });
    } finally {
      clearTimeout(timeout);
    }
  }

  private errorForResponse(response: Response, json: unknown): Error {
    if (response.status === 401) {
      return new UnauthorizedApiError("API rejected worker credentials");
    }
    const message =
      json && typeof json === "object" && "error" in json
        ? JSON.stringify((json as { error: unknown }).error)
        : `Unexpected API response (status ${response.status})`;
    return new ApiResponseError(message, response.status);
  }
}
