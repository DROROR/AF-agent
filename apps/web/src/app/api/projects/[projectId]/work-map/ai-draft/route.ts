import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * "Tell AI what you want" - video-planning UX simplification, 2026-08-31.
 * Real single Anthropic call, same longer, dedicated timeout as
 * mapping-suggestions/generate/route.ts - never the normal 8-second one.
 * Must match GENERATE_SUGGESTIONS_TIMEOUT_MS in projects-api-client.ts.
 */
const AI_WORK_MAP_DRAFT_TIMEOUT_MS = 180_000;

/** POST /api/projects/:projectId/work-map/ai-draft - drafts a complete Work Map from free-text instructions + real project context. Never touches the execution plan or Mapping Assistant suggestions. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/work-map/ai-draft`, {
    method: "POST",
    body,
    timeoutMs: AI_WORK_MAP_DRAFT_TIMEOUT_MS
  });
}
