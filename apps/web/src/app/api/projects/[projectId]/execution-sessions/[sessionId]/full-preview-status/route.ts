import { proxyToApi } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET .../execution-sessions/:sessionId/full-preview-status - metadata only, null when no complete preview has been captured yet (a real valid state) - proxied verbatim. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }): Promise<Response> {
  const { projectId, sessionId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/full-preview-status`, {
    method: "GET"
  });
}
