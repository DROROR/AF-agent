import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

function assetPath(projectId: string, assetId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;
}

/** GET /api/projects/:projectId/assets/:assetId - a single real asset's metadata. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> }
): Promise<Response> {
  const { projectId, assetId } = await params;
  return proxyToApi(assetPath(projectId, assetId), { method: "GET" });
}

/** PATCH /api/projects/:projectId/assets/:assetId - label/notes only, see updateAssetRequestSchema. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> }
): Promise<Response> {
  const { projectId, assetId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(assetPath(projectId, assetId), { method: "PATCH", body });
}

/** DELETE /api/projects/:projectId/assets/:assetId - refused with 409 by the real API if the asset is still mapped in the current execution plan. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; assetId: string }> }
): Promise<Response> {
  const { projectId, assetId } = await params;
  return proxyToApi(assetPath(projectId, assetId), { method: "DELETE" });
}
