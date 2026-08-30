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

/**
 * POST /api/projects/:projectId/execution-plan - creates the initial DRAFT
 * plan deterministically from the project's current manifest. The real
 * API is what enforces project ownership/existence and refuses (409) if a
 * plan already exists - this route never re-implements those checks, it
 * only forwards the request (and the real API's real status/body) verbatim,
 * same as every other route in this file. The request body is always the
 * schema's own empty object - createExecutionPlanRequestSchema takes no
 * fields - so nothing from the browser is trusted here beyond the session
 * cookie proxyToApi already forwards.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan`, { method: "POST", body: {} });
}
