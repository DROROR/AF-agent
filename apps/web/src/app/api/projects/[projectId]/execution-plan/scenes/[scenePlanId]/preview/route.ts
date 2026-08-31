import { proxyBinaryDownload } from "../../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * GET .../execution-plan/scenes/:scenePlanId/preview (client-facing UX
 * redesign, "M. VISUAL PREVIEWS ARE MANDATORY") - the scene's latest real,
 * AE-captured evidence preview frame bytes, for direct <img> display.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; scenePlanId: string }> }
): Promise<Response> {
  const { projectId, scenePlanId } = await params;
  return proxyBinaryDownload(
    `/api/projects/${encodeURIComponent(projectId)}/execution-plan/scenes/${encodeURIComponent(scenePlanId)}/preview`
  );
}
