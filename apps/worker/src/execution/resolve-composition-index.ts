import { z } from "zod";
import type { FixedJsxScript } from "./jsx-templates.js";
import { buildResolveCompositionIndexScript } from "./jsx-templates.js";
import { unwrapJsxResult } from "./unwrap-jsx-result.js";

/**
 * The one thing this module needs from EITHER real transport -
 * `HeroicSwanMcpClient.runFixedInspectionScript` (read-only inspection,
 * used by CREATE_PREVIEW/RENDER/INSPECT_SCENE_EVIDENCE) and
 * `HeroicSwanAeMutationClient.runFixedOperation` (EXECUTE_FRAME's own
 * mutation channel) return the exact same real shape
 * (`{ok:true,content}|{ok:false,error:{message}}` - ToolCallResult and
 * MutationCallResult are structurally identical, just named differently
 * per module) - a plain callback here, rather than either concrete
 * client type, lets ONE resolver implementation serve both, real
 * 2026-09-11 EXECUTE_FRAME durable-identity fix included.
 */
export type RunResolveScript = (script: FixedJsxScript) => Promise<{ ok: true; content: unknown } | { ok: false; error: { message: string } }>;

/** What buildResolveCompositionIndexScript's own JSON.stringify(...) result actually contains. */
const resolveCompositionIndexScriptResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      resolvedAeProjectItemIndex: z.number().int().positive(),
      name: z.string(),
      widthPx: z.number(),
      heightPx: z.number(),
      frameRate: z.number(),
      durationSeconds: z.number()
    })
    .strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

export type ResolveCompositionIndexResult =
  | {
      ok: true;
      resolvedAeProjectItemIndex: number;
      name: string;
      widthPx: number;
      heightPx: number;
      frameRate: number;
      durationSeconds: number;
    }
  | { ok: false; reason: string };

/**
 * manifestCompositionId format this codebase actually uses for an
 * organically-discovered (INSPECT_TEMPLATE) composition - `"comp-" + `
 * AE's own real, persistent `CompItem.id` (see build-project-facts.ts's
 * own doc comment: "AE's own persistent comp.id survives reordering and
 * is preferred when available"). A composition-CREATING operation like
 * BUILD_HORIZONTAL_COMPOSITION/BUILD_REELS_COMPOSITION currently derives
 * its OWN manifest entry's compositionId differently - a synthetic
 * deterministic hash, never `"comp-" + ` a real AE id (see
 * register-horizontal-composition.ts/register-reels-composition.ts's own
 * `deterministicId([...])` call) - so this parser deliberately returns
 * `null` for those, and for the `"idx-N"` fallback shape
 * (build-project-facts.ts's own doc comment: used only when the
 * id-capturing detail call itself failed, so no real id was ever
 * available to record). Callers MUST treat `null` as "no durable id
 * exists to re-resolve by for this composition" and refuse to guess -
 * never silently fall back to trusting a stale index in that case.
 */
export function parseStableCompositionNumericId(manifestCompositionId: string): number | null {
  const match = /^comp-(\d+)$/.exec(manifestCompositionId);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

/**
 * CRITICAL SAFETY FIX (real 2026-09-11 incident, session a7fee3d9): a
 * persisted `aeProjectItemIndex` is only ever a snapshot of
 * `app.project.item(n)`'s ordinal position at capture time - real
 * incident, `aeProjectItemIndex` 48 (persisted for "Scene 1"/comp-1)
 * resolved to "Pre-comp 5" instead, after a later BUILD_HORIZONTAL_
 * COMPOSITION inserted a new top-level composition item and shifted
 * every later index. This function is the generic runtime resolver: it
 * never trusts a persisted index - it scans the CURRENTLY OPEN AE project
 * (via the caller's own already-connected, read-only
 * HeroicSwanMcpClient) for the composition that owns the manifest's
 * durable numeric id RIGHT NOW, and returns its REAL CURRENT
 * aeProjectItemIndex plus its current name/dimensions/frameRate/duration
 * for the caller's own further cross-checks (e.g. Fix A's frame-range
 * computation). Fails closed - never falls back to any caller-supplied
 * index - if the id no longer resolves to anything, or resolves to a
 * composition whose name no longer matches what was expected (see
 * buildResolveCompositionIndexScript's own doc comment for the full
 * rationale, including the duplicate-name case).
 */
export async function resolveCompositionIndex(
  runScript: RunResolveScript,
  expectedCompositionNumericId: number,
  expectedName: string
): Promise<ResolveCompositionIndexResult> {
  const script = buildResolveCompositionIndexScript(expectedCompositionNumericId, expectedName);
  const result = await runScript(script);
  if (!result.ok) {
    return { ok: false, reason: `ae_run_jsx failed while resolving composition id ${String(expectedCompositionNumericId)}: ${result.error.message}` };
  }
  const unwrapped = unwrapJsxResult(result.content);
  if (!unwrapped.ok) {
    return { ok: false, reason: unwrapped.reason };
  }
  const parsed = resolveCompositionIndexScriptResultSchema.safeParse(unwrapped.value);
  if (!parsed.success) {
    return { ok: false, reason: `resolve-composition-index script response did not match the expected shape: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { ok: false, reason: parsed.data.failureReason };
  }
  return {
    ok: true,
    resolvedAeProjectItemIndex: parsed.data.resolvedAeProjectItemIndex,
    name: parsed.data.name,
    widthPx: parsed.data.widthPx,
    heightPx: parsed.data.heightPx,
    frameRate: parsed.data.frameRate,
    durationSeconds: parsed.data.durationSeconds
  };
}
