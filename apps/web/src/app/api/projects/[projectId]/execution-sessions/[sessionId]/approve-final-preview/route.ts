import { proxyToApi } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST .../execution-sessions/:sessionId/approve-final-preview - the separate, later human gate before the final Landscape/Reels render can be dispatched - proxied verbatim. Genuinely bodyless. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }): Promise<Response> {
  const { projectId, sessionId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/approve-final-preview`, {
    method: "POST"
  });
}
