import { proxyToApi } from "../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects - real project list, proxied from the Fastify control-plane API. See api-proxy.ts. */
export async function GET(): Promise<Response> {
  return proxyToApi("/api/projects", { method: "GET" });
}

/**
 * POST /api/projects - creates a real project from an already-produced,
 * schema-valid manifest (see @dyo/schemas' createProjectRequestSchema).
 * The real Fastify API is what validates and persists this; this route
 * only forwards the request body verbatim, same as every other proxy in
 * this app. Exists specifically so a disposable project can be created
 * for smoke-testing through the same authenticated dashboard/API path a
 * real operator uses - never by scripting a raw psql insert or hitting
 * the internal Fastify port directly (see
 * docs/engineering/PRODUCTION_SAFETY.md).
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  return proxyToApi("/api/projects", { method: "POST", body });
}
