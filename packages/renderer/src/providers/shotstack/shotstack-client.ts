import { z } from "zod";
import { RendererNetworkError, RendererRequestError } from "../../errors.js";
import type { ShotstackConfig } from "./shotstack-env.js";
import { SHOTSTACK_STATUSES, type ShotstackStatus } from "./shotstack-status.js";
import type { ShotstackEditPayload } from "./shotstack-payload.js";

const REQUEST_TIMEOUT_MS = 10_000;

/** Response shapes confirmed against Shotstack's own API docs (https://shotstack.io/docs/api/), not guessed. */
const createRenderResponseSchema = z.object({
  success: z.boolean(),
  response: z.object({ id: z.string().min(1) })
});

const renderStatusResponseSchema = z.object({
  success: z.boolean(),
  response: z.object({
    id: z.string().min(1),
    status: z.enum(SHOTSTACK_STATUSES),
    url: z.string().url().nullable().optional(),
    error: z.string().nullable().optional()
  })
});

export interface ShotstackRenderStatus {
  id: string;
  status: ShotstackStatus;
  url: string | null;
  error: string | null;
}

/**
 * Thin HTTP boundary to the real Shotstack Edit API. Never logs
 * `config.apiKey` - it is sent only as the `x-api-key` header value, never
 * included in an error message (docs/engineering/SECURITY.md,
 * OBSERVABILITY.md "never log secrets"). Not exercised against a live
 * Shotstack account in this session - see docs/SHOTSTACK-POC.md.
 */
export class ShotstackClient {
  constructor(
    private readonly config: ShotstackConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async createRender(payload: ShotstackEditPayload): Promise<{ id: string }> {
    const response = await this.request("POST", "/render", payload);
    const json: unknown = await response.json();
    const parsed = createRenderResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new RendererRequestError("Unexpected Shotstack create-render response shape", response.status);
    }
    return { id: parsed.data.response.id };
  }

  async getRenderStatus(id: string): Promise<ShotstackRenderStatus> {
    const response = await this.request("GET", `/render/${id}`);
    const json: unknown = await response.json();
    const parsed = renderStatusResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new RendererRequestError("Unexpected Shotstack render-status response shape", response.status);
    }
    return {
      id: parsed.data.response.id,
      status: parsed.data.response.status,
      url: parsed.data.response.url ?? null,
      error: parsed.data.response.error ?? null
    };
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
    } catch (cause) {
      throw new RendererNetworkError(`Failed to reach Shotstack (${path})`, { cause });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new RendererRequestError(`Shotstack request failed (${path})`, response.status);
    }
    return response;
  }
}
