import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WORKER_REGISTRATION_SECRET: z
    .string()
    .min(16, "WORKER_REGISTRATION_SECRET must be at least 16 characters"),
  WORKER_HEARTBEAT_STALE_AFTER_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * How long a CLAIMED/RUNNING job may go without its worker's heartbeat
   * before the sweep marks it FAILED (WORKER_OFFLINE). REAL 2026-11-01: a
   * worker's machine starved under a 4K After Effects save and the worker
   * process itself stalled for seven minutes; with the 30 s heartbeat window
   * the sweep failed the job the worker was still running and then finished.
   * The dashboard's ONLINE/OFFLINE keeps the short window; a job gets ten
   * minutes.
   */
  JOB_STALE_AFTER_MS: z.coerce.number().int().positive().default(600_000),
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
  ASSET_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),
  /** ffprobe, used to measure an uploaded video's size and duration (2026-10-09). A bare name resolves through PATH; unset means "ffprobe". A missing binary never breaks an upload - the video's size just stays unknown. */
  FFPROBE_PATH: z.string().min(1).default("ffprobe"),
  /** Rendered videos are far larger than typical input assets - a separate, larger ceiling (render-delivery phase section 4). Default 2GB. */
  RENDER_ARTIFACT_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
  /**
   * Master secret for encrypting a user's own BYOK AI provider API key at
   * rest (infrastructure/crypto/secret-cipher.ts) - deliberately OPTIONAL
   * here (never a hard boot-time requirement, unlike WORKER_REGISTRATION_SECRET
   * above) so a server without it set still starts normally; only the
   * BYOK connect/use paths themselves fail closed with a clear error if a
   * caller ever actually needs it and it's unset (see
   * EncryptionNotConfiguredError). Any non-empty string works - it is
   * hashed to a fixed-length AES-256 key internally, never required to be
   * exactly N hex characters.
   */
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(16, "CREDENTIALS_ENCRYPTION_KEY must be at least 16 characters").optional()
});

export type Env = z.infer<typeof envSchema>;

/** Environment variables are an external boundary - validated with Zod like any other input. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
