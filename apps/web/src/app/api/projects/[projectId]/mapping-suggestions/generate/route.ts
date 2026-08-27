import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST /api/projects/:projectId/mapping-suggestions/generate - runs deterministic (and AI, if configured) matching; never mutates the execution plan itself. No request body. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/generate`, { method: "POST" });
}
