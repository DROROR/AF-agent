import { proxyToApi } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST .../execution-sessions/:sessionId/approve-preview - the human first-preview approval gate (section 10) - proxied verbatim. Genuinely bodyless (no fields to approve beyond the id in the URL itself). */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionId: string }> }): Promise<Response> {
  const { projectId, sessionId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/approve-preview`, {
    method: "POST"
  });
}
