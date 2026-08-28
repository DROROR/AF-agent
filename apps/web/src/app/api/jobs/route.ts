import { proxyToApi } from "../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs - real job dispatch, proxied verbatim to the Fastify
 * control-plane API (see dispatch-job.ts). The browser only ever sends the
 * narrow, allowlisted DispatchJobRequest shape - this route never adds,
 * removes, or reinterprets any field.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  return proxyToApi("/api/jobs", { method: "POST", body });
}
