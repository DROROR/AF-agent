import { proxyToApi } from "../../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * GET .../execution-plan/scenes/:scenePlanId/preview-status (client-facing
 * UX redesign, "M. VISUAL PREVIEWS ARE MANDATORY") - metadata only, null
 * when this scene's composition has never had a real AE preview frame
 * captured yet (a real valid state, not an error) - proxied verbatim.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; scenePlanId: string }> }
): Promise<Response> {
  const { projectId, scenePlanId } = await params;
  return proxyToApi(
    `/api/projects/${encodeURIComponent(projectId)}/execution-plan/scenes/${encodeURIComponent(scenePlanId)}/preview-status`,
    { method: "GET" }
  );
}
