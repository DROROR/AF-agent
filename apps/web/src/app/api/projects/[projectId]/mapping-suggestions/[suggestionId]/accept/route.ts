import { proxyToApi } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST /api/projects/:projectId/mapping-suggestions/:suggestionId/accept - real, typed MAP_ASSET/SET_TEXT/... edit, applied only via an explicit human Accept. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; suggestionId: string }> }
): Promise<Response> {
  const { projectId, suggestionId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/${encodeURIComponent(suggestionId)}/accept`, {
    method: "POST",
    body
  });
}
