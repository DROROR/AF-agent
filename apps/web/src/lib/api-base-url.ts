import { z } from "zod";

/**
 * Phase 3 runs the dashboard on the same box as the Fastify API, calling it
 * over loopback only - see docs/engineering/SECURITY.md and CLAUDE.md Phase 3
 * task 10 ("do not expose sensitive control-plane endpoints publicly").
 * The browser never talks to the Fastify API directly; only this server-side
 * code does.
 */
const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:4000";

const envSchema = z.object({
  DYO_API_INTERNAL_URL: z.string().trim().url().optional()
});

export function getApiBaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const parsed = envSchema.parse(source);
  const url = parsed.DYO_API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  return url.replace(/\/+$/, "");
}
