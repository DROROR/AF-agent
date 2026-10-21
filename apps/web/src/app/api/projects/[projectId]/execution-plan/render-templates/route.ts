import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:projectId/execution-plan/render-templates (2026-10-21) -
 * the Render Settings and Output Module template names the project's
 * worker's After Effects last reported, proxied verbatim. Read-only: the
 * Render Settings tab offers them under the two name fields, and the real
 * API refuses a name that is not on the list when the output is saved.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/render-templates`, { method: "GET" });
}
