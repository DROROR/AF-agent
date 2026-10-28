import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects/:projectId/execution-plan/reconcile-readiness - recomputes
 * every scene's "still needs a decision" state from its current mappings,
 * proxied verbatim. Never touches content, never bumps the revision, never
 * approves anything. Needed when the resolution rule itself changes (2026-10-28:
 * unclassified shape layers stopped counting as decisions to make) - a plan
 * stored under the old rule stays locked until it is recomputed once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json().catch(() => ({}));
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-plan/reconcile-readiness`, { method: "POST", body });
}
