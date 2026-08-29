import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const brandRulesConfigSchema = z
  .object({
    requireLogoPresence: z.boolean(),
    requiredHebrewText: z.string().min(1),
    /** Null while the client has not yet supplied the real value - never a guessed/invented hex (CLAUDE.md, 2026-08-29 closure audit). */
    dyoBlueHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "dyoBlueHex must be #RRGGBB")
      .nullable(),
    rtlPreservedByConstruction: z.boolean()
  })
  .strict();
export type BrandRulesConfig = z.infer<typeof brandRulesConfigSchema>;

const DEFAULT_BRAND_RULES_RELATIVE_PATH = "dyo-brand-rules.yaml";

/**
 * Reads and validates dyo-brand-rules.yaml (repo root) fresh on every call -
 * never cached at module load, since this file is meant to be
 * operator-editable (e.g. supplying the real DYO blue hex once the client
 * provides it) without requiring an API restart. Defaults to
 * `<process.cwd()>/dyo-brand-rules.yaml` - process.cwd() is the repo root
 * at production runtime (see deploy/pm2/ecosystem.config.cjs's own
 * `cwd: repoRoot` for dyo-api) and in every test run in this repo (vitest
 * is always invoked from the repo root). `DYO_BRAND_RULES_PATH` overrides
 * this for tests/dev that need a different fixture file.
 */
export function loadBrandRulesConfig(pathOverride?: string): BrandRulesConfig {
  const path = pathOverride ?? process.env.DYO_BRAND_RULES_PATH ?? resolve(process.cwd(), DEFAULT_BRAND_RULES_RELATIVE_PATH);
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = parse(raw);
  return brandRulesConfigSchema.parse(parsed);
}
