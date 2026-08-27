import { proxyToApi } from "../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST /api/projects/:projectId/execution-sessions - "Start Execution" (multi-scene-accumulation phase, section 14). Real create-or-return-existing session, proxied verbatim - see create-execution-session.ts. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await params;
  const body: unknown = await request.json();
  return proxyToApi(`/api/projects/${encodeURIComponent(projectId)}/execution-sessions`, { method: "POST", body });
}
