import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST /api/projects/:projectId/mapping-suggestions/accept-batch - accepts several PENDING suggestions as one batched plan edit; refused whole (never partial) if any one is invalid/stale/not-PENDING. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/accept-batch`, { method: "POST", body });
}
