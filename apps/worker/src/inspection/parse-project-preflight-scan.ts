import { z } from "zod";

/**
 * Real 2026-09-11 incident, and the reason this exists at all: the
 * manifest's `preflight.pluginReferences` was an honest empty stub for
 * this project's entire history (see build-project-facts.ts's own prior
 * doc comment) - "plugins require layer effect enumeration", which no
 * already-called discovery tool's confirmed shape exposes. Wiring one in
 * was repeatedly deferred because the obvious implementation (one more
 * ae_get_composition-style MCP round trip PER composition) carries a real,
 * previously-experienced MCP-timeout risk on large projects.
 *
 * That deferral rationale is now dead: a real standalone run against a
 * genuine 83-item client project proved buildScanProjectEffectsScript
 * enumerates EVERY composition's effects in a SINGLE ae_run_jsx call
 * (all iteration happens inside AE's own JS engine - no per-composition
 * round trip at all), fast enough to be unremarkable. INSPECT_TEMPLATE
 * can therefore afford exactly one such call, and `pluginReferences` can
 * finally be real.
 *
 * Why this matters beyond tidiness: an empty `pluginReferences` was
 * indistinguishable from "genuinely no plugins", and a real operator DID
 * read it that way while a template was in fact dependent on Video
 * Copilot Element 3D throughout - the exact false-negative that cost this
 * engagement a full misdiagnosis cycle. From here, an empty array means
 * "really scanned, really none", and a failed scan is surfaced as an
 * explicit unknownItems entry instead of silently looking like zero.
 */
const effectFactSchema = z
  .object({
    name: z.string(),
    matchName: z.string(),
    enabled: z.boolean()
  })
  .strict();

const layerEffectsSchema = z
  .object({
    layerIndex: z.number(),
    layerName: z.string(),
    enabled: z.boolean(),
    effects: z.array(effectFactSchema)
  })
  .strict();

const compositionEffectsSchema = z
  .object({
    aeProjectItemIndex: z.number(),
    compositionId: z.number(),
    compositionName: z.string(),
    layers: z.array(layerEffectsSchema)
  })
  .strict();

const footageItemSchema = z
  .object({
    name: z.string(),
    path: z.string().nullable(),
    missing: z.boolean()
  })
  .strict();

export const projectPreflightScanResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      compositionCount: z.number(),
      compositionsWithEffects: z.array(compositionEffectsSchema),
      /** Every text layer's own font, in discovery order, with duplicates - deduped here rather than in ExtendScript (which has no Set). Absent on a response from an older worker build that only scanned effects. */
      fonts: z.array(z.string()).optional(),
      /** Every FootageItem in the project, with AE's own `footageMissing` flag. Absent on a response from an older worker build that only scanned effects. */
      footage: z.array(footageItemSchema).optional()
    })
    .strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

export type ProjectPreflightScan = z.infer<typeof projectPreflightScanResultSchema>;

/**
 * Every genuine Adobe-native effect's own matchName is "ADBE "-prefixed -
 * a consistently observed After Effects scripting convention rather than
 * a guarantee citable from a single Adobe spec, so this is deliberately
 * the ONLY judgment applied, and the raw matchName is always preserved
 * alongside it so a human can disagree. Proven concretely against real
 * client data during the 2026-09-11 incident: Video Copilot Element 3D
 * reports "VIDEOCOPILOT 3DArray", while every native effect in the same
 * project ("ADBE Gaussian Blur 2" and similar) carried the prefix.
 */
export function isThirdPartyEffectMatchName(matchName: string): boolean {
  return !matchName.startsWith("ADBE ");
}

export interface ProjectPreflightEvidence {
  /** Distinct third-party effect matchNames, sorted - what preflight.pluginReferences is populated from. */
  pluginReferences: string[];
  /** Every composition name a third-party effect was found in, distinct and sorted - real evidence for a human, never a guess. */
  affectedCompositionNames: string[];
  /** How many individual third-party effect instances were found (an effect applied to five layers counts five times) - the honest scale of the dependency. */
  thirdPartyEffectInstanceCount: number;
  /**
   * Distinct text-layer fonts, sorted - what preflight.requiredFonts is
   * populated from. This is what the project ASKS FOR; AE's scripting API
   * exposes no "is this font actually installed here" flag, so an
   * unavailable font (the real Evolventa-Bold/Evolventa-Regular case on
   * the 2026-09-11 candidate) is indistinguishable from an available one
   * at this layer - a human still has to confirm availability on the
   * render machine. Never claimed otherwise.
   */
  requiredFonts: string[];
  /** Distinct resolvable footage paths, sorted - what preflight.footageReferenced is populated from. */
  footageReferenced: string[];
  /** Footage AE itself reports as missing (`FootageItem.footageMissing`) - a real, machine-confirmed fact, not an inference. */
  missingFootage: { name: string; expectedPath: string | null }[];
  /** False when the responding worker build only scanned effects (no fonts/footage fields) - callers must then NOT treat empty font/footage lists as confirmed. */
  fontAndFootageScanned: boolean;
}

export type ParseProjectPreflightScanResult = { ok: true; evidence: ProjectPreflightEvidence } | { ok: false; reason: string };

/**
 * Derives the manifest's real plugin evidence from one raw
 * buildScanProjectEffectsScript result. Never throws, never guesses: an
 * unparseable or script-reported-failed scan returns a typed failure the
 * caller must surface (as an unknownItems entry), never a silently empty
 * plugin list.
 */
export function parseProjectPreflightScan(value: unknown): ParseProjectPreflightScanResult {
  const parsed = projectPreflightScanResultSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: `project preflight scan response did not match the expected shape: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { ok: false, reason: `the project preflight scan script itself reported failure: ${parsed.data.failureReason}` };
  }

  const pluginReferences = new Set<string>();
  const affectedCompositionNames = new Set<string>();
  let thirdPartyEffectInstanceCount = 0;

  for (const composition of parsed.data.compositionsWithEffects) {
    for (const layer of composition.layers) {
      for (const effect of layer.effects) {
        if (!isThirdPartyEffectMatchName(effect.matchName)) {
          continue;
        }
        pluginReferences.add(effect.matchName);
        affectedCompositionNames.add(composition.compositionName);
        thirdPartyEffectInstanceCount += 1;
      }
    }
  }

  const footage = parsed.data.footage ?? [];
  const footageReferenced = new Set<string>();
  const missingFootage: { name: string; expectedPath: string | null }[] = [];
  for (const item of footage) {
    if (item.missing) {
      missingFootage.push({ name: item.name, expectedPath: item.path });
      continue;
    }
    if (item.path !== null) {
      footageReferenced.add(item.path);
    }
  }

  return {
    ok: true,
    evidence: {
      pluginReferences: [...pluginReferences].sort(),
      affectedCompositionNames: [...affectedCompositionNames].sort(),
      thirdPartyEffectInstanceCount,
      requiredFonts: [...new Set(parsed.data.fonts ?? [])].sort(),
      footageReferenced: [...footageReferenced].sort(),
      missingFootage,
      fontAndFootageScanned: parsed.data.fonts !== undefined && parsed.data.footage !== undefined
    }
  };
}
