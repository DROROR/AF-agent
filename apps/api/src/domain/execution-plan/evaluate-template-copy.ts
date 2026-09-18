import { assessTemplateCopy, type PlaceholderMapping, type ScenePlanEntry, type TemplateCopyAssessment, type TemplateManifest } from "@dyo/schemas";

/**
 * THE LEFTOVER-TEMPLATE-COPY GATE (2026-09-18).
 *
 * Joins a plan's own mappings to the untouched template text captured on the
 * project's manifest, and reports every mapping that must not pass. The
 * comparison itself lives in `@dyo/schemas`' pure `assessTemplateCopy`, so the
 * API, the dashboard and the tests all judge a plan identically.
 *
 * INDEPENDENT PER MAPPING, BY CONSTRUCTION. Templates reuse wording: the same
 * sentence can appear in several scenes, and one composition can even be used
 * by several scenes at once. Each mapping is assessed on its own text, its own
 * placeholder's own template text, and its own recorded decision - so deciding
 * one occurrence never silently clears another, and two scenes that share
 * wording each need their own explicit decision.
 *
 * SCENES NOT MARKED FOR USE ARE NOT JUDGED: an excluded scene renders nothing,
 * so its mappings cannot ship template copy.
 */

export interface TemplateCopyFinding {
  scenePlanId: string;
  sceneName: string;
  mappingId: string;
  placeholderName: string | null;
  assessment: TemplateCopyAssessment;
}

/** Placeholder identity -> the template's own text for it. `undefined` for a placeholder whose manifest entry never captured it (see placeholderSchema.originalText). */
function templateTextFor(manifest: TemplateManifest, manifestPlaceholderId: string | null): string | null | undefined {
  if (manifestPlaceholderId === null) {
    // A human-added mapping has no manifest placeholder and therefore no
    // template wording it could be a leftover copy OF - the text came from a
    // person, not from the purchased template.
    return null;
  }
  for (const scene of manifest.scenes) {
    for (const placeholder of scene.placeholders) {
      if (placeholder.placeholderId === manifestPlaceholderId) {
        // A truncated capture is deliberately reported as "never captured":
        // comparing a partial string as if it were the whole text could
        // declare a genuinely different line identical.
        return placeholder.originalTextTruncated === true ? undefined : placeholder.originalText;
      }
    }
  }
  // The plan references a placeholder the current manifest no longer has.
  // Other gates (manifest sha256, composition resolution) already refuse that
  // case loudly; here it is simply unverifiable, so it blocks.
  return undefined;
}

export function assessMappingTemplateCopy(mapping: PlaceholderMapping, manifest: TemplateManifest): TemplateCopyAssessment {
  return assessTemplateCopy({
    mappingText: mapping.text,
    templateText: templateTextFor(manifest, mapping.manifestPlaceholderId),
    // Absent and null both mean "no decision" - see placeholderMappingSchema.
    decision: mapping.keepTemplateText ?? null
  });
}

/** Every blocking finding across the scenes actually marked for use, in scene then mapping order. Empty means nothing is left to decide. */
export function findTemplateCopyBlockers(scenePlans: readonly ScenePlanEntry[], manifest: TemplateManifest): TemplateCopyFinding[] {
  const findings: TemplateCopyFinding[] = [];
  for (const scene of scenePlans) {
    if (!scene.use) {
      continue;
    }
    for (const mapping of scene.mappings) {
      const assessment = assessMappingTemplateCopy(mapping, manifest);
      if (assessment.blocks) {
        findings.push({
          scenePlanId: scene.id,
          sceneName: scene.compositionName,
          mappingId: mapping.id,
          placeholderName: mapping.placeholderName,
          assessment
        });
      }
    }
  }
  return findings;
}

/** One human-readable line per blocking finding, naming the scene and layer so an operator can act without opening the database. */
export function describeTemplateCopyBlockers(findings: readonly TemplateCopyFinding[]): string[] {
  return findings.map((finding) => `${finding.sceneName} / ${finding.placeholderName ?? finding.mappingId}: ${finding.assessment.reason ?? "blocked"}`);
}
