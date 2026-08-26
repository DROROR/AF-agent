import { proxyToApi } from "../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects/:projectId/execution-plan - real plan + Dynamic Scene Table, proxied from the Fastify control-plane API. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan`, { method: "GET" });
}

/**
 * PATCH /api/projects/:projectId/execution-plan - applies real, typed
 * execution-plan edit operations (see @dyo/schemas' executionPlanEditOperationSchema).
 * The request body is forwarded verbatim; the real API is what validates
 * and enforces baseRevision/allowlisted-operation-shape, this route never
 * re-implements that check.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan`, { method: "PATCH", body });
}
