import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST /api/projects/:projectId/execution-plan/reject - real rejection transition, proxied verbatim. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/reject`, { method: "POST", body });
}
