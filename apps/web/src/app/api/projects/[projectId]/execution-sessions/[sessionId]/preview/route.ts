import { proxyBinaryDownload } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET .../execution-sessions/:sessionId/preview - the session's current preview PNG, authenticated + project-scoped, for direct <img> display in the dashboard (section 3). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; sessionId: string }> }
): Promise<Response> {
  const { projectId, sessionId } = await params;
  return proxyBinaryDownload(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions/${encodeURIComponent(sessionId)}/preview`);
}
