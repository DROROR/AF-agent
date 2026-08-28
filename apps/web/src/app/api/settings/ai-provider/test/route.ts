import { proxyToApi } from "../../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** POST /api/settings/ai-provider/test - "Test Connection". Never persists anything, regardless of the outcome. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  return proxyToApi("/api/settings/ai-provider/test", { method: "POST", body });
}
