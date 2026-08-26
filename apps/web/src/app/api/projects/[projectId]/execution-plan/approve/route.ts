import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST /api/projects/:projectId/execution-plan/approve - real approval transition, proxied verbatim. A refusal (e.g. stale revision, source sha mismatch) reaches the browser as the real API's own error. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/approve`, { method: "POST", body });
}
