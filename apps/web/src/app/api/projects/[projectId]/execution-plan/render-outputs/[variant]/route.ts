import { proxyToApi } from "../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * PUT /api/projects/:projectId/execution-plan/render-outputs/:variant -
 * explicit render-output configuration (render-delivery phase section
 * 1/2/3), proxied verbatim. The real API resolves aeProjectItemIndex/
 * compositionName itself from the project's current manifest - this route
 * only ever forwards manifestCompositionId + the two template name
 * fields, never an index (see set-render-output-config.ts).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string; variant: string }> }
): Promise<Response> {
  const { projectId, variant } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/render-outputs/${encodeURIComponent(variant)}`, {
    method: "PUT",
    body
  });
}
