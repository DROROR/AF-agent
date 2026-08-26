import { proxyBinaryDownload } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects/:projectId/assets/:assetId/file - the real stored bytes, for use directly as an <img>/<video> src on this same origin. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> }
): Promise<Response> {
  const { projectId, assetId } = await params;
  return proxyBinaryDownload(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/file`);
}
