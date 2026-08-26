import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../api-base-url";
import { SESSION_COOKIE_NAME } from "../auth/session-cookie";

const REQUEST_TIMEOUT_MS = 8_000;

export interface ProxyOptions {
  method: "GET" | "PATCH" | "POST";
  body?: unknown;
}

/**
 * The one bridge between the browser and the Fastify control-plane API for
 * project/execution-plan routes - same "browser never calls the Fastify API
 * directly" rule as fetch-dashboard-status.ts (see api-base-url.ts).
 * Forwards this request's own HttpOnly session cookie as a bearer token
 * (the same session middleware.ts already required before this route ran)
 * and relays the real API's status code and JSON body verbatim - it never
 * reshapes, retries, or fabricates a response, so a real 401/404/409 from
 * the API reaches the browser as that same status, never a generic 500.
 */
export async function proxyToApi(path: string, options: ProxyOptions): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sessionToken) {
    headers["authorization"] = `Bearer ${sessionToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: options.method,
      headers,
      cache: "no-store",
      signal: controller.signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    });
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return NextResponse.json(json, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Could not reach the control-plane API"
        }
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
