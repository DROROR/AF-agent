import { aiProviderStatusResponseSchema, errorResponseSchema, testAiProviderConnectionResponseSchema, type AiProviderStatus, type ConnectAiProviderRequest, type TestAiProviderConnectionResponse } from "@dyo/schemas";

const REQUEST_TIMEOUT_MS = 8_000;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string };

/** Same request/error shape as projects-api-client.ts's own `request`/`toErrorResult` - BYOK settings are account-scoped rather than project-scoped, so this lives in its own client file instead of that one. */
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

/** Settings -> AI Provider's own "Connection status" - never the key itself, only masked last4/model/provider (see aiProviderStatusSchema). */
export async function fetchAiProviderStatus(): Promise<ApiResult<AiProviderStatus>> {
  const { status, json } = await request("/api/settings/ai-provider");
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = aiProviderStatusResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected AI provider status contract" };
  }
  return { ok: true, data: parsed.data.status };
}

/** "Test Connection" - never persists anything, regardless of the outcome. */
export async function testAiProviderConnection(request_: ConnectAiProviderRequest): Promise<ApiResult<TestAiProviderConnectionResponse>> {
  const { status, json } = await request("/api/settings/ai-provider/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request_)
  });
  if (status !== 200) {
    return toErrorResult(status, json);
  }
  const parsed = testAiProviderConnectionResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected connection-test contract" };
  }
  return { ok: true, data: parsed.data };
}

/** "Save & Connect" and "Replace Key" - the same real action; the API re-verifies the key before ever persisting it. */
export async function connectAiProvider(request_: ConnectAiProviderRequest): Promise<ApiResult<AiProviderStatus>> {
  const { status, json } = await request("/api/settings/ai-provider", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request_)
  });
  if (status !== 201) {
    return toErrorResult(status, json);
  }
  const parsed = aiProviderStatusResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, status, code: null, message: "Response did not match the expected AI provider status contract" };
  }
  return { ok: true, data: parsed.data.status };
}

/** "Disconnect" - deletes the encrypted key outright, never merely hides it. */
export async function disconnectAiProvider(): Promise<ApiResult<true>> {
  const { status, json } = await request("/api/settings/ai-provider", { method: "DELETE" });
  if (status !== 204) {
    return toErrorResult(status, json);
  }
  return { ok: true, data: true };
}
