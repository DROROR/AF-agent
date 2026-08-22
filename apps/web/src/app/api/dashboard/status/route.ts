import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { fetchDashboardStatus } from "../../../../lib/fetch-dashboard-status";

// Always fetch fresh - this is a live monitoring snapshot, never cached/static.
export const dynamic = "force-dynamic";

/**
 * The only bridge between the browser and the Fastify API. The browser never
 * calls the Fastify API directly - see docs/engineering/SECURITY.md and
 * CLAUDE.md Phase 3 task 10. Only read endpoints are proxied
 * (/health/live, /health/ready, GET /api/workers); nothing here can mutate
 * worker/job state.
 */
export async function GET(): Promise<NextResponse> {
  const status = await fetchDashboardStatus(getApiBaseUrl());
  return NextResponse.json(status);
}
