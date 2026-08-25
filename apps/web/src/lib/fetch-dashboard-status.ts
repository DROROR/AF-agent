import { listWorkersResponseSchema } from "@dyo/schemas";
import type { DashboardStatus } from "./dashboard-types";

const REQUEST_TIMEOUT_MS = 5_000;

async function safeFetch(
  fetchImpl: typeof fetch,
  url: string,
  headers?: HeadersInit
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { cache: "no-store", signal: controller.signal, ...(headers ? { headers } : {}) });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Server-side only: aggregates the Fastify API's liveness, readiness and
 * worker-list endpoints into one dashboard-shaped snapshot. Never throws -
 * an unreachable API or a response that no longer matches @dyo/schemas'
 * contract degrades to an explicit "unavailable" state instead of crashing
 * the dashboard (CLAUDE.md Phase 3 task 8).
 *
 * GET /api/workers now requires a dashboard session (CLAUDE.md: "no public
 * worker/admin data without authentication") - sessionToken is the same
 * value carried by this app's own HttpOnly cookie, forwarded here as a
 * bearer token. Route handlers calling this always have one, since
 * middleware.ts already requires authentication before this code runs; a
 * missing/invalid token just surfaces as workers: null, same as any other
 * unreachable-API case, never a crash.
 */
export async function fetchDashboardStatus(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
  sessionToken?: string
): Promise<DashboardStatus> {
  const authHeaders: HeadersInit | undefined = sessionToken
    ? { authorization: `Bearer ${sessionToken}` }
    : undefined;
  const [liveResponse, readyResponse, workersResponse] = await Promise.all([
    safeFetch(fetchImpl, `${apiBaseUrl}/health/live`),
    safeFetch(fetchImpl, `${apiBaseUrl}/health/ready`),
    safeFetch(fetchImpl, `${apiBaseUrl}/api/workers`, authHeaders)
  ]);

  const apiOk = liveResponse !== null && liveResponse.ok;

  let database: DashboardStatus["database"] = "unknown";
  if (apiOk && readyResponse !== null) {
    database = readyResponse.ok ? "ok" : "error";
  }

  let workers: DashboardStatus["workers"] = null;
  if (apiOk && workersResponse !== null && workersResponse.ok) {
    try {
      const json: unknown = await workersResponse.json();
      const parsed = listWorkersResponseSchema.safeParse(json);
      workers = parsed.success ? parsed.data.workers : null;
    } catch {
      workers = null;
    }
  }

  return {
    api: apiOk ? "ok" : "error",
    database,
    workers,
    fetchedAt: new Date().toISOString()
  };
}
