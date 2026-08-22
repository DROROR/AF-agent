import { z } from "zod";
import { RendererConfigError } from "../../errors.js";

/**
 * Base URLs confirmed against Shotstack's own API docs
 * (https://shotstack.io/docs/api/) - not guessed. "sandbox" is Shotstack's
 * free/trial stage, "production" requires a paid account.
 */
const SHOTSTACK_BASE_URLS = {
  sandbox: "https://api.shotstack.io/edit/stage",
  production: "https://api.shotstack.io/edit/v1"
} as const;

const envSchema = z.object({
  SHOTSTACK_API_KEY: z.string().trim().min(1, "SHOTSTACK_API_KEY is required"),
  SHOTSTACK_ENV: z.enum(["sandbox", "production"]).default("sandbox")
});

export interface ShotstackConfig {
  apiKey: string;
  baseUrl: string;
  env: "sandbox" | "production";
}

/** Environment variables are an external boundary - validated with Zod like any other input. Never logs SHOTSTACK_API_KEY. */
export function loadShotstackConfig(source: NodeJS.ProcessEnv = process.env): ShotstackConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new RendererConfigError(`Invalid Shotstack environment: ${parsed.error.message}`);
  }
  return {
    apiKey: parsed.data.SHOTSTACK_API_KEY,
    baseUrl: SHOTSTACK_BASE_URLS[parsed.data.SHOTSTACK_ENV],
    env: parsed.data.SHOTSTACK_ENV
  };
}
