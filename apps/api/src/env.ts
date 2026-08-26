import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WORKER_REGISTRATION_SECRET: z
    .string()
    .min(16, "WORKER_REGISTRATION_SECRET must be at least 16 characters"),
  WORKER_HEARTBEAT_STALE_AFTER_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /**
   * Explicit, deliberate escape hatch for a genuine one-off manual
   * production diagnostic run outside PM2 - see production-runtime-guard.ts.
   * Deliberately NOT z.coerce.boolean() (which coerces any non-empty
   * string, including "false", to true) - only the literal string "1" or
   * "true" opts in; anything else (including unset) stays false.
   */
  ALLOW_UNMANAGED_PRODUCTION_START: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  /** Never /tmp - a real, persistent directory outside the repo tree. No default: a missing value is a real configuration error, not silently assumed. */
  ASSET_STORAGE_ROOT: z.string().min(1, "ASSET_STORAGE_ROOT is required"),
  ASSET_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024)
});

export type Env = z.infer<typeof envSchema>;

/** Environment variables are an external boundary - validated with Zod like any other input. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
