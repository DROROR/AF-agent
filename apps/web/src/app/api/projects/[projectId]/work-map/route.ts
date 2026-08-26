import { proxyToApi } from "../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects/:projectId/work-map - real client-intent Work Map, or { workMap: null } if none has been saved yet. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/work-map`, { method: "GET" });
}

/** PUT /api/projects/:projectId/work-map - replaces the entry list as one new revision (optimistic concurrency via baseRevision). */
export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/work-map`, { method: "PUT", body });
}
