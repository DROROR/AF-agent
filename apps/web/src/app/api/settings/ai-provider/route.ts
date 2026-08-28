import { proxyToApi } from "../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

const PATH = "/api/settings/ai-provider";

/** GET /api/settings/ai-provider - masked connection status only (see aiProviderStatusSchema). Never the key. */
export async function GET(): Promise<Response> {
  return proxyToApi(PATH, { method: "GET" });
}

/** POST /api/settings/ai-provider - "Save & Connect" / "Replace Key". The real API re-verifies the key before ever persisting it. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  return proxyToApi(PATH, { method: "POST", body });
}

/** DELETE /api/settings/ai-provider - "Disconnect". Deletes the encrypted key outright. */
export async function DELETE(): Promise<Response> {
  return proxyToApi(PATH, { method: "DELETE" });
}
