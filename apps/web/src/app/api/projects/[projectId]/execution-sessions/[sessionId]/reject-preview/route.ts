import { proxyToApi } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST .../execution-sessions/:sessionId/reject-preview - the human first-preview rejection gate (section 3/10) - proxied verbatim. Genuinely bodyless. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }): Promise<Response> {
  const { projectId, sessionId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/reject-preview`, {
    method: "POST"
  });
}
