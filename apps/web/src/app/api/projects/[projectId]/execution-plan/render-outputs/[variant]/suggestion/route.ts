import { proxyToApi } from "../../../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:projectId/execution-plan/render-outputs/:variant/suggestion
 * (2026-10-04) - what this output could be set up with, proxied verbatim.
 *
 * A non-technical client was sent from the Preview tab to an Advanced screen
 * to type two After Effects template names. The real API offers them only
 * when nothing has to be guessed (see suggest-render-output-config.ts), and
 * this is read-only: taking the suggestion still goes through the PUT one
 * level up, exactly as filling in the form does.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; variant: string }> }
): Promise<Response> {
  const { projectId, variant } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/render-outputs/${encodeURIComponent(variant)}/suggestion`, {
    method: "GET"
  });
}
