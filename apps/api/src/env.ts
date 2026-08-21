import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WORKER_REGISTRATION_SECRET: z
    .string()
    .min(16, "WORKER_REGISTRATION_SECRET must be at least 16 characters"),
  WORKER_HEARTBEAT_STALE_AFTER_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")
});

export type Env = z.infer<typeof envSchema>;

/** Environment variables are an external boundary - validated with Zod like any other input. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
