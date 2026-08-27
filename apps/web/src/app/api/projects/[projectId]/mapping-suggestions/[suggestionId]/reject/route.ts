import { proxyToApi } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST /api/projects/:projectId/mapping-suggestions/:suggestionId/reject - a pure review decision; never edits the execution plan. No request body. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; suggestionId: string }> }
): Promise<Response> {
  const { projectId, suggestionId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/${encodeURIComponent(suggestionId)}/reject`, {
    method: "POST"
  });
}
