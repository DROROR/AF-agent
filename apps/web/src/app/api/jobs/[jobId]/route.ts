import { proxyToApi } from "../../../../lib/server/api-proxy";

export const dynamic = "force-dynamic";

/** GET /api/jobs/:jobId - a real job's own status/result, scoped server-side to the dashboard user who dispatched it (see routes/jobs.ts). */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const { jobId } = await params;
  return proxyToApi(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
}
