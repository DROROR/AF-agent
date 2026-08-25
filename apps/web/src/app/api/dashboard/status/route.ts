import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { fetchDashboardStatus } from "../../../../lib/fetch-dashboard-status";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/session-cookie";

// Always fetch fresh - this is a live monitoring snapshot, never cached/static.
export const dynamic = "force-dynamic";

/**
 * The only bridge between the browser and the Fastify API. The browser never
 * calls the Fastify API directly - see docs/engineering/SECURITY.md and
 * CLAUDE.md Phase 3 task 10. Only read endpoints are proxied
 * (/health/live, /health/ready, GET /api/workers); nothing here can mutate
 * worker/job state. This route itself requires a dashboard session
 * (enforced by middleware.ts) and forwards that same session to the
 * now-protected GET /api/workers call - see fetch-dashboard-status.ts.
 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const status = await fetchDashboardStatus(getApiBaseUrl(), fetch, sessionToken);
  return NextResponse.json(status);
}
