import { z } from "zod";
import { HeroicSwanMcpClient } from "../../inspection/heroic-swan-mcp-client.js";
import { parseCompositionList } from "../../inspection/parse-mcp-shapes.js";
import { windowsPathsEqual } from "../../inspection/canonical-windows-path.js";
import { buildOpenProjectScript } from "../jsx-templates.js";
import { unwrapJsxResult } from "../unwrap-jsx-result.js";
import { parseStableCompositionNumericId, resolveCompositionIndex } from "../resolve-composition-index.js";

export interface VerifyRenderCompositionParams {
  workingProjectPath: string;
  /** The manifest's own durable composition identity - see resolve-composition-index.ts's own doc comment. Used to re-resolve a possibly-stale aeProjectItemIndex before ever trusting it (real 2026-09-11 incident). */
  manifestCompositionId: string;
  aeProjectItemIndex: number;
  compositionName: string;
}

export type VerifyRenderCompositionResult =
  | {
      ok: true;
      /**
       * Real 2026-09-10 incident fix (session a7fee3d9) - the composition's
       * own real, freshly-read duration/frameRate, from the SAME
       * ae_list_compositions scan this verification already performs (zero
       * extra cost) - the caller uses these to compute an explicit full-
       * composition -s/-e frame range for aerender (see aerender-args.ts's
       * own doc comment on why that is now required, never left to the
       * Render Settings template's own Time Span default).
       */
      durationSeconds: number;
      frameRate: number;
    }
  | { ok: false; reason: string };

/** What buildOpenProjectScript's own JSON.stringify(...) result actually contains - mirrors ae-edit-bridge.ts's openProjectResultValueSchema/heroic-swan-template-inspector.ts's openProjectScriptResultSchema exactly (this file goes through HeroicSwanMcpClient.runFixedInspectionScript + unwrapJsxResult, neither of theirs, so it needs its own copy rather than importing a module-private schema). */
const openProjectScriptResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      resultingValue: z.object({ openedPath: z.string().nullable(), openedName: z.string().nullable() })
    })
    .strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

/**
 * Canonical composition addressing safety net for RENDER/CREATE_PREVIEW
 * (render-engine phase section 6): aerender itself only ever addresses a
 * composition by NAME (`-comp <name>` - see aerender-args.ts), so before
 * ever invoking it this worker independently, read-only-ly (never a
 * mutation - only the allowlisted `ae_list_compositions` tool, plus the
 * one fixed, versioned `buildOpenProjectScript` open-check below) proves:
 *
 *   0. the session's own real WORKING COPY - never the immutable source
 *      .aep, and never "whatever happens to already be open" - is
 *      actually open in AE right now (see below).
 *   1. the composition at the canonical `aeProjectItemIndex` genuinely has
 *      the expected `compositionName` (never trusted from a stale/wrong
 *      manifest alone), and
 *   2. NO OTHER composition anywhere else in the project shares that exact
 *      same name - an ambiguous duplicate name fails closed even if (1)
 *      also holds, since aerender's own name-only addressing could
 *      otherwise resolve to the wrong one of two identically-named comps.
 *
 * CRITICAL SAFETY FIX (real 2026-09-11 incident, job 47b0b42f...): this
 * function previously never opened/checked the AE project itself - it
 * called `ae_list_compositions` against whatever project happened to
 * already be open, on the same unenforced assumption
 * execute-scene-edit-executor.ts's own doc comment already documented and
 * fixed for EXECUTE_FRAME (see AeEditBridge.openProject's doc comment).
 * The real incident proved this assumption false for CREATE_PREVIEW too:
 * AE was sitting on Untitled/Home (no project open) when this job ran,
 * `ae_list_compositions` returned nothing at the working copy's own
 * expected aeProjectItemIndex, and the job failed with a confusing
 * "does not resolve to any composition" error rather than the real cause.
 * `params.workingProjectPath` was already part of this function's own
 * signature (used by every caller for on-disk hashing) but was never
 * actually read here - it now is: reuses buildOpenProjectScript verbatim
 * (the SAME fixed, versioned, already-shipped script both INSPECT_TEMPLATE
 * and EXECUTE_FRAME's AeEditBridge.openProject already use) via THIS
 * client's own `runFixedInspectionScript` (a read-only `ae_run_jsx`
 * channel - see that method's own doc comment - never the mutation
 * client), then independently verifies AE's own self-reported opened path
 * against `params.workingProjectPath` via the same canonical
 * `windowsPathsEqual` comparison EXECUTE_FRAME's own model uses. Fails
 * closed (never proceeds to `ae_list_compositions`) if AE reports any
 * other path, or none at all - never the source .aep, since
 * `params.workingProjectPath` is the only path this function is ever
 * given and it is always the session's own derived working-copy path
 * (see create-full-preview-executor.ts/render-project-executor.ts's own
 * `sessionWorkingCopyPath` call sites - this function itself never
 * derives or accepts sourceProjectPath).
 */
export interface CompositionVerifier {
  verify(params: VerifyRenderCompositionParams): Promise<VerifyRenderCompositionResult>;
}

export class HeroicSwanCompositionVerifier implements CompositionVerifier {
  constructor(private readonly aeMcpPath: string) {}

  async verify(params: VerifyRenderCompositionParams): Promise<VerifyRenderCompositionResult> {
    const client = new HeroicSwanMcpClient({ aeMcpPath: this.aeMcpPath });
    try {
      await client.connect();
    } catch (error) {
      await client.close();
      return { ok: false, reason: `could not connect to ae-mcp: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      // Step 0 (the real 2026-09-11 fix): never trust "whatever project is
      // currently open in AE" - explicitly (re-)open the session's own
      // working copy and independently verify AE's own self-reported path
      // matches it exactly, BEFORE ever resolving a composition against it.
      const openScript = buildOpenProjectScript(params.workingProjectPath);
      const openResult = await client.runFixedInspectionScript(openScript);
      if (!openResult.ok) {
        return { ok: false, reason: `could not confirm the session working copy is open in After Effects: ae_run_jsx failed: ${openResult.error.message}` };
      }
      const unwrappedOpen = unwrapJsxResult(openResult.content);
      if (!unwrappedOpen.ok) {
        return { ok: false, reason: `could not confirm the session working copy is open in After Effects: ${unwrappedOpen.reason}` };
      }
      const parsedOpen = openProjectScriptResultSchema.safeParse(unwrappedOpen.value);
      if (!parsedOpen.success) {
        return {
          ok: false,
          reason: `could not confirm the session working copy is open in After Effects: open-project script's response did not match the expected shape: ${parsedOpen.error.message}`
        };
      }
      if (!parsedOpen.data.ok) {
        return { ok: false, reason: `could not confirm the session working copy is open in After Effects: ${parsedOpen.data.failureReason}` };
      }
      if (!windowsPathsEqual(parsedOpen.data.resultingValue.openedPath, params.workingProjectPath)) {
        return {
          ok: false,
          reason: `AE reports "${parsedOpen.data.resultingValue.openedPath ?? "no project"}" is open, not the requested working copy ("${params.workingProjectPath}") - refusing to verify a composition against the wrong project`
        };
      }

      // CRITICAL SAFETY FIX (real 2026-09-11 incident, session a7fee3d9):
      // params.aeProjectItemIndex is only ever a snapshot of the
      // manifest's/render-output-config's own last-observed position -
      // see resolve-composition-index.ts's own doc comment for the full
      // incident trace (BUILD_HORIZONTAL_COMPOSITION/BUILD_REELS_
      // COMPOSITION insert a new top-level item and shift every later
      // index; nothing re-scans a pre-existing composition's own index
      // afterward). Re-resolve by the manifest's durable numeric id
      // before ever trusting the caller-supplied index. A composition
      // with no durable id captured (e.g. a derived Landscape/Reels
      // master - see that parser's own doc comment) falls back to the
      // caller-supplied index unchanged - identical to this function's
      // prior behavior, no regression.
      let effectiveAeProjectItemIndex = params.aeProjectItemIndex;
      const stableNumericId = parseStableCompositionNumericId(params.manifestCompositionId);
      if (stableNumericId !== null) {
        const resolved = await resolveCompositionIndex((script) => client.runFixedInspectionScript(script), stableNumericId, params.compositionName);
        if (!resolved.ok) {
          return { ok: false, reason: `could not re-resolve composition "${params.manifestCompositionId}" by its durable id: ${resolved.reason}` };
        }
        effectiveAeProjectItemIndex = resolved.resolvedAeProjectItemIndex;
      }

      const result = await client.callTool("ae_list_compositions");
      if (!result.ok) {
        return { ok: false, reason: `ae_list_compositions failed: ${result.error.message}` };
      }
      const parsed = parseCompositionList(result.content);
      if (!parsed.ok) {
        return { ok: false, reason: `ae_list_compositions response did not match the confirmed shape: ${parsed.reason}` };
      }

      const atIndex = parsed.value.find((c) => c.index === effectiveAeProjectItemIndex);
      if (!atIndex) {
        return { ok: false, reason: `aeProjectItemIndex ${effectiveAeProjectItemIndex} does not resolve to any composition in this project` };
      }
      if (atIndex.name !== params.compositionName) {
        return {
          ok: false,
          reason: `aeProjectItemIndex ${effectiveAeProjectItemIndex} resolved to composition "${atIndex.name}", expected "${params.compositionName}" - refusing to render the wrong composition`
        };
      }

      const sameName = parsed.value.filter((c) => c.name === params.compositionName);
      if (sameName.length > 1) {
        return {
          ok: false,
          reason: `composition name "${params.compositionName}" is ambiguous - ${sameName.length} compositions in this project share it (indices: ${sameName.map((c) => c.index).join(", ")}) and aerender addresses only by name; refusing to render an ambiguous target`
        };
      }

      return { ok: true, durationSeconds: atIndex.durationSeconds, frameRate: atIndex.frameRate };
    } finally {
      await client.close();
    }
  }
}

export class CompositionVerifierUnavailableError extends Error {
  constructor(reason?: string) {
    super(reason ?? "RENDER's composition verification cannot run: no real ae-mcp transport is configured (AE_MCP_PATH is unset).");
    this.name = "CompositionVerifierUnavailableError";
  }
}

/** Honest stub - never fabricates a verification result. */
export class NotAvailableCompositionVerifier implements CompositionVerifier {
  async verify(_params: VerifyRenderCompositionParams): Promise<VerifyRenderCompositionResult> {
    throw new CompositionVerifierUnavailableError();
  }
}
