import { proxyToApi } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST .../execution-sessions/:sessionId/request-final-preview-changes - marks the complete preview as not approved so the client can return to Mappings/Plan - proxied verbatim. Genuinely bodyless. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }): Promise<Response> {
  const { projectId, sessionId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/request-final-preview-changes`, {
    method: "POST"
  });
}
