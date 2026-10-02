import { proxyToApi } from "../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/projects/:projectId/brand-inputs - replaces the whole
 * brand-inputs object (the API's own documented contract: logo, brand
 * colours, text instructions and the client's website in one write).
 *
 * 2026-10-02: the API route has existed since the brand-inputs phase, but
 * nothing in the dashboard ever called it, so a client had no way to tell
 * the system their own website or describe their business. This proxy is
 * what the Work Map "about the client" card writes through.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/brand-inputs`, { method: "PATCH", body });
}
