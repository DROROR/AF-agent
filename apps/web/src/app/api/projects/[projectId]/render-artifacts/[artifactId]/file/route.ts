import { proxyBinaryDownload } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects/:projectId/render-artifacts/:artifactId/file - the real stored render bytes, authenticated + project-scoped, for direct browser download. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; artifactId: string }> }
): Promise<Response> {
  const { projectId, artifactId } = await params;
  return proxyBinaryDownload(`/api/projects/${encodeURIComponent(projectId)}/render-artifacts/${encodeURIComponent(artifactId)}/file`);
}
