import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../api-base-url";
import { SESSION_COOKIE_NAME } from "../auth/session-cookie";

const REQUEST_TIMEOUT_MS = 8_000;

export interface ProxyOptions {
  method: "GET" | "PATCH" | "POST" | "PUT" | "DELETE";
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
  // content-type: application/json is only ever sent alongside a real
  // body - a bodyless request (DELETE, or any future no-payload call)
  // must never carry it, since Fastify's JSON content-type parser reads
  // the header as a promise of a JSON body and throws
  // FST_ERR_CTP_EMPTY_JSON_BODY the moment it finds zero bytes instead.
  const headers: Record<string, string> = options.body !== undefined ? { "content-type": "application/json" } : {};
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
    // A 204 (e.g. DELETE) genuinely has no body - relaying it as a real
    // empty response rather than attempting to JSON-encode "null" as its
    // body, which a 204 response must never carry.
    if (!text) {
      return new NextResponse(null, { status: response.status });
    }
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
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

/**
 * Forwards a multipart/form-data upload byte-for-byte to the control-plane
 * API - unlike proxyToApi, the body is never JSON-encoded (it's the
 * client's real file bytes) and the original `content-type` header
 * (carrying the multipart boundary) is forwarded verbatim rather than
 * overwritten with "application/json". Used only by the asset upload
 * route - see routes/assets.ts's real multipart handling on the API side.
 */
export async function proxyMultipartUpload(path: string, request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const contentType = request.headers.get("content-type");
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["content-type"] = contentType;
  }
  if (sessionToken) {
    headers["authorization"] = `Bearer ${sessionToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const body = await request.arrayBuffer();
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: controller.signal,
      body
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
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

/**
 * Streams a real asset's raw bytes back from the control-plane API for
 * preview/download - never re-encodes as JSON, and forwards the real
 * `content-type` the API reports (see get-asset-file.ts) so the browser
 * can render an <img>/<video> directly against this same-origin URL.
 */
export async function proxyBinaryDownload(path: string): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers["authorization"] = `Bearer ${sessionToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return NextResponse.json(json, { status: response.status });
    }
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    return new NextResponse(buffer, { status: 200, headers: { "content-type": contentType } });
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
