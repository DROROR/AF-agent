import { proxyBinaryDownload } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET .../execution-sessions/:sessionId/full-preview - the session's current complete-preview video bytes, authenticated + project-scoped, for direct <video> playback in the dashboard. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<Response> {
  const { projectId, sessionId } = await params;
  return proxyBinaryDownload(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/full-preview`);
}
