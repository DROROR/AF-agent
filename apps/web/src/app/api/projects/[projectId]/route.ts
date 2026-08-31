import { proxyToApi } from "../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects/:projectId - real project + manifest detail, proxied from the Fastify control-plane API. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}`, { method: "GET" });
}

/**
 * DELETE /api/projects/:projectId - offline-safe-control-plane phase,
 * section 1 ("Add Delete Project"). The real API refuses this with 409
 * PROJECT_HAS_ACTIVE_JOB if a job is still non-terminal for this project -
 * surfaced to the caller as a normal ApiResult failure, never silently
 * retried or masked.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
}
