import { proxyBinaryDownload, RENDER_ARTIFACT_DOWNLOAD_TIMEOUT_MS } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:projectId/render-artifacts/:artifactId/file - the
 * real stored render bytes, authenticated + project-scoped, for direct
 * browser download. Uses RENDER_ARTIFACT_DOWNLOAD_TIMEOUT_MS (5 minutes),
 * not the normal 8-second default - a real render file can be large (up
 * to 2GB) and the normal timeout is sized for ordinary JSON calls.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; artifactId: string }> }
): Promise<Response> {
  const { projectId, artifactId } = await params;
  return proxyBinaryDownload(
    `/api/projects/${encodeURIComponent(projectId)}/render-artifacts/${encodeURIComponent(artifactId)}/file`,
    RENDER_ARTIFACT_DOWNLOAD_TIMEOUT_MS
  );
}
