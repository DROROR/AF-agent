import type { ExecutionPlan } from "@dyo/schemas";
import { loadBrandRulesConfig, type BrandRulesConfig } from "./brand-rules-config.js";

export type { BrandRulesConfig } from "./brand-rules-config.js";

export const BRAND_RULE_VIOLATION_CODES = ["LOGO_PRESENCE", "REQUIRED_HEBREW_TEXT", "DYO_BLUE_USAGE"] as const;
export type BrandRuleViolationCode = (typeof BRAND_RULE_VIOLATION_CODES)[number];

export interface BrandRuleViolation {
  rule: BrandRuleViolationCode;
  message: string;
}

export interface BrandRuleWarning {
  rule: "DYO_BLUE_UNCONFIGURED";
  message: string;
}

export interface BrandRulesValidationResult {
  ok: boolean;
  violations: BrandRuleViolation[];
  warnings: BrandRuleWarning[];
}

/**
 * Validates an execution plan's active (use: true) scenes against the
 * permanent DYO brand rules (dyo-brand-rules.yaml) - called as a hard gate
 * before a plan may move DRAFT -> APPROVED (see approve-execution-plan.ts).
 * Required brand elements never "silently disappear": every rule with a
 * known, checkable canonical value is a hard violation if unmet. A rule
 * whose canonical value is not yet configured (dyoBlueHex: null) surfaces
 * as an explicit warning instead of either silently passing or freezing
 * every project's approval over a value nobody has supplied yet -
 * dyo-brand-rules.yaml's own doc comment explains this decision in full.
 */
export function validateBrandRules(
  plan: Pick<ExecutionPlan, "scenePlans">,
  config: BrandRulesConfig = loadBrandRulesConfig()
): BrandRulesValidationResult {
  const activeMappings = plan.scenePlans.filter((scene) => scene.use).flatMap((scene) => scene.mappings);

  const violations: BrandRuleViolation[] = [];
  const warnings: BrandRuleWarning[] = [];

  if (config.requireLogoPresence) {
    const hasLogo = activeMappings.some((mapping) => mapping.selectedAssetType === "logo" && mapping.selectedAssetId !== null);
    if (!hasLogo) {
      violations.push({
        rule: "LOGO_PRESENCE",
        message: "No active scene has a logo-type asset mapped - CLAUDE.md requires the client/company logo to appear at least once in every video."
      });
    }
  }

  const hasRequiredHebrewText =
    config.requiredHebrewText.length === 0 ||
    activeMappings.some((mapping) => mapping.text !== null && mapping.text.includes(config.requiredHebrewText));
  if (!hasRequiredHebrewText) {
    violations.push({
      rule: "REQUIRED_HEBREW_TEXT",
      message: `No active scene includes the required text "${config.requiredHebrewText}" - CLAUDE.md requires every video to include this Hebrew text.`
    });
  }

  if (config.dyoBlueHex === null) {
    warnings.push({
      rule: "DYO_BLUE_UNCONFIGURED",
      message:
        "dyo-brand-rules.yaml's dyoBlueHex is not yet configured, so the official-DYO-blue rule is NOT being enforced for this approval - set the real hex value once the client supplies it."
    });
  } else {
    // "When applicable" (CLAUDE.md): only enforced against scenes that
    // actually have a color-classified mapping selected - a plan with no
    // brand-color layer at all has nothing to check here.
    const colorMappings = activeMappings.filter(
      (mapping) => mapping.placeholderClassification.value === "color" && mapping.colorHex !== null
    );
    if (colorMappings.length > 0) {
      const usesDyoBlue = colorMappings.some((mapping) => mapping.colorHex === config.dyoBlueHex);
      if (!usesDyoBlue) {
        violations.push({
          rule: "DYO_BLUE_USAGE",
          message: `Active color-type mappings are set, but none use the configured official DYO blue (${config.dyoBlueHex}) - CLAUDE.md requires DYO App branding to always use the official DYO blue.`
        });
      }
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}
