import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects/:projectId/execution-plan/revisions - real, read-only revision history, proxied from the Fastify control-plane API. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/revisions`, { method: "GET" });
}
