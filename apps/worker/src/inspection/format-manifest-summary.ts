import type { TemplateManifest } from "@dyo/schemas";

/**
 * Plain-text, human-readable rendering of a TemplateManifest for the
 * approval workflow - machine facts (evidence.source: "read_directly")
 * and inferred/uncertain items (evidence.source: "inferred"/"unknown")
 * are kept visually distinguishable, never merged into one undifferentiated
 * list.
 */
export function formatManifestSummary(manifest: TemplateManifest): string {
  const lines: string[] = [];

  lines.push(`Template: ${manifest.templateName} (${manifest.templateId})`);
  lines.push(`Source: ${manifest.sourceProject.path} (sha256 ${manifest.sourceProject.sha256})`);
  lines.push(`After Effects version: ${manifest.afterEffects.version ?? "unknown"}`);
  lines.push(`Generated: ${manifest.generatedAt}`);
  lines.push("");

  lines.push(`Compositions (${manifest.compositions.length}):`);
  for (const c of manifest.compositions) {
    const nested = c.isNestedOnlyReferenced ? " [nested only - not a scene candidate]" : "";
    lines.push(`  - ${c.name} - ${c.widthPx}x${c.heightPx}, ${c.durationSeconds.toFixed(2)}s, ${c.frameRate}fps${nested}`);
  }
  lines.push("");

  lines.push(`Candidate scenes (${manifest.scenes.length}, original project order preserved):`);
  for (const s of manifest.scenes) {
    lines.push(
      `  ${s.originalOrderIndex + 1}. ${s.compositionId} - ${s.durationSeconds.toFixed(2)}s - ${s.placeholders.length} placeholder(s)`
    );
    for (const p of s.placeholders) {
      const tag = p.placeholderType === "unknown" ? "UNKNOWN" : p.placeholderType;
      const editability = p.editable ? "" : " (not editable)";
      const machineFact = p.evidence.source === "read_directly" ? "fact" : p.evidence.source;
      lines.push(`       [${tag}]${editability} "${p.layerName}" (index ${p.layerIndex}) - ${machineFact}: ${p.evidence.reason}`);
    }
  }
  lines.push("");

  lines.push(`Fonts referenced: ${manifest.preflight.requiredFonts.length ? manifest.preflight.requiredFonts.join(", ") : "none discovered"}`);
  lines.push(`Footage referenced: ${manifest.preflight.footageReferenced.length}`);

  if (manifest.preflight.missingFootage.length > 0) {
    lines.push(`MISSING FOOTAGE (${manifest.preflight.missingFootage.length}):`);
    for (const m of manifest.preflight.missingFootage) {
      lines.push(`  - ${m.name}${m.expectedPath ? ` (expected at: ${m.expectedPath})` : ""}`);
    }
  }

  if (manifest.preflight.pluginReferences.length > 0) {
    lines.push(`Plugin/effect dependencies detected: ${manifest.preflight.pluginReferences.join(", ")}`);
  }

  if (manifest.unknownItems.length > 0) {
    lines.push("");
    lines.push(`UNCERTAIN / UNKNOWN items requiring human review (${manifest.unknownItems.length}):`);
    for (const u of manifest.unknownItems) {
      lines.push(`  - ${u.context}: ${u.reason}`);
    }
  }

  return lines.join("\n");
}
