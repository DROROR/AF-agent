import { proxyToApi } from "../../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/**
 * Real production bug, 2026-08-30: a real Anthropic-backed generate call
 * for a project needing AI help on most/all of its scenes routinely takes
 * longer than the ordinary 8-second REQUEST_TIMEOUT_MS - proven via
 * production logs and a ~9-minute DB poll showing zero suggestions ever
 * persisted from two real attempts that both hit the 8-second timeout.
 * Must match GENERATE_SUGGESTIONS_TIMEOUT_MS in projects-api-client.ts -
 * the browser and this proxy leg are bounded the same way.
 */
const GENERATE_SUGGESTIONS_TIMEOUT_MS = 180_000;

/** POST /api/projects/:projectId/mapping-suggestions/generate - runs deterministic (and AI, if configured) matching; never mutates the execution plan itself. No request body. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/mapping-suggestions/generate`, {
    method: "POST",
    timeoutMs: GENERATE_SUGGESTIONS_TIMEOUT_MS
  });
}
