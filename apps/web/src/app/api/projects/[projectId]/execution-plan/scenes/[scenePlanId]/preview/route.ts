import { proxyBinaryDownload } from "../../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * REAL 2026-10-04 DEFECT: this proxy dropped the query string, so a request
 * for ONE slot's own frame (`?mappingId=`) reached the API as a request for
 * the scene's latest frame. Every slot of a scene was then shown - and its
 * decision bound to - whichever frame had been captured last. Only
 * `mappingId` is forwarded; nothing else a caller appends reaches the API.
 */
function slotQuery(request: Request): string {
  const mappingId = new URL(request.url).searchParams.get("mappingId");
  return mappingId === null || mappingId === "" ? "" : `?mappingId=${encodeURIComponent(mappingId)}`;
}

/**
 * GET .../execution-plan/scenes/:scenePlanId/preview (client-facing UX
 * redesign, "M. VISUAL PREVIEWS ARE MANDATORY") - the scene's latest real,
 * AE-captured evidence preview frame bytes, for direct <img> display.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; scenePlanId: string }> }
): Promise<Response> {
  const { projectId, scenePlanId } = await params;
  const query = slotQuery(request);
  return proxyBinaryDownload(
    `/api/projects/${encodeURIComponent(projectId)}/execution-plan/scenes/${encodeURIComponent(scenePlanId)}/preview${query}`
  );
}
