import {
  claimJobResponseSchema,
  jobDtoSchema,
  registerWorkerResponseSchema,
  workerDtoSchema,
  type ClaimJobResponse,
  type HeartbeatRequest,
  type JobDto,
  type RegisterWorkerRequest,
  type RegisterWorkerResponse,
  type ReportJobStatusRequest,
  type WorkerDto
} from "@dyo/schemas";
import { ApiResponseError, NetworkError, UnauthorizedApiError } from "../errors/worker-error.js";

const REQUEST_TIMEOUT_MS = 10_000;

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
