import { proxyMultipartUpload, proxyToApi } from "../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects/:projectId/assets - real Asset Catalog list, proxied from the Fastify control-plane API. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "GET" });
}

/**
 * POST /api/projects/:projectId/assets - forwards the browser's real
 * multipart upload byte-for-byte; the control-plane API is what validates
 * MIME/size/mediaKind, this route never re-implements that check.
 */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyMultipartUpload(`/api/projects/${encodeURIComponent(projectId)}/assets`, request);
}
