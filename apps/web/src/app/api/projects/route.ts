import { proxyToApi } from "../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/projects - real project list, proxied from the Fastify control-plane API. See api-proxy.ts. */
export async function GET(): Promise<Response> {
  return proxyToApi("/api/projects", { method: "GET" });
}
