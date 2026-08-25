import { z } from "zod";
import {
  authSessionResponseSchema,
  errorResponseSchema,
  userFacingAuthResponseSchema,
  type AuthSessionResponse,
  type ErrorCode,
  type LogInRequest,
  type SignUpRequest,
  type UserDto
} from "@dyo/schemas";

const REQUEST_TIMEOUT_MS = 5_000;

/** Carries the real status/code/message from the API so a route handler can pass it straight through to the browser. */
export class AuthApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "AuthApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function callAuthApi(
  apiBaseUrl: string,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(`${apiBaseUrl}${path}`, { ...init, cache: "no-store", signal: controller.signal });
  } catch {
    throw new AuthApiRequestError(503, "INTERNAL_ERROR", "The authentication service is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson<T>(
  apiBaseUrl: string,
  path: string,
  body: unknown,
  responseSchema: z.ZodType<T>,
  fetchImpl: typeof fetch
): Promise<T> {
  const response = await callAuthApi(
    apiBaseUrl,
    path,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    fetchImpl
  );
  const json: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(json);
    throw new AuthApiRequestError(
      response.status,
      parsedError.success ? parsedError.data.error.code : "INTERNAL_ERROR",
      parsedError.success ? parsedError.data.error.message : "Request failed"
    );
  }

  return responseSchema.parse(json);
}

export function signUpRequest(
  apiBaseUrl: string,
  request: SignUpRequest,
  fetchImpl: typeof fetch = fetch
): Promise<AuthSessionResponse> {
  return postJson(apiBaseUrl, "/api/auth/signup", request, authSessionResponseSchema, fetchImpl);
}

export function logInRequest(
  apiBaseUrl: string,
  request: LogInRequest,
  fetchImpl: typeof fetch = fetch
): Promise<AuthSessionResponse> {
  return postJson(apiBaseUrl, "/api/auth/login", request, authSessionResponseSchema, fetchImpl);
}

/** Best-effort: logout always clears the browser's cookie regardless of whether this call succeeds. */
export async function logOutRequest(
  apiBaseUrl: string,
  sessionToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  try {
    await callAuthApi(
      apiBaseUrl,
      "/api/auth/logout",
      { method: "POST", headers: { authorization: `Bearer ${sessionToken}` } },
      fetchImpl
    );
  } catch {
    // Swallowed deliberately - the cookie gets cleared client-side either way.
  }
}

/** Never throws - an unreachable API or an invalid/expired session both degrade to "not authenticated". */
export async function fetchCurrentUser(
  apiBaseUrl: string,
  sessionToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<UserDto | null> {
  try {
    const response = await callAuthApi(
      apiBaseUrl,
      "/api/auth/me",
      { headers: { authorization: `Bearer ${sessionToken}` } },
      fetchImpl
    );
    if (!response.ok) {
      return null;
    }
    const json: unknown = await response.json().catch(() => null);
    const parsed = userFacingAuthResponseSchema.safeParse(json);
    return parsed.success ? parsed.data.user : null;
  } catch {
    return null;
  }
}
