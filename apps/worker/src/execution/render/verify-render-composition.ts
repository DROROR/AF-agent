import { HeroicSwanMcpClient } from "../../inspection/heroic-swan-mcp-client.js";
import { parseCompositionList } from "../../inspection/parse-mcp-shapes.js";

export interface VerifyRenderCompositionParams {
  workingProjectPath: string;
  aeProjectItemIndex: number;
  compositionName: string;
}

export type VerifyRenderCompositionResult = { ok: true } | { ok: false; reason: string };

/**
 * Canonical composition addressing safety net for RENDER (render-engine
 * phase section 6): aerender itself only ever addresses a composition by
 * NAME (`-comp <name>` - see aerender-args.ts), so before ever invoking it
 * this worker independently, read-only-ly (never a mutation - only the
 * allowlisted `ae_list_compositions` tool) proves:
 *
 *   1. the composition at the canonical `aeProjectItemIndex` genuinely has
 *      the expected `compositionName` (never trusted from a stale/wrong
 *      manifest alone), and
 *   2. NO OTHER composition anywhere else in the project shares that exact
 *      same name - an ambiguous duplicate name fails closed even if (1)
 *      also holds, since aerender's own name-only addressing could
 *      otherwise resolve to the wrong one of two identically-named comps.
 *
 * This assumes ae-mcp is already reachable against the WORKING COPY (the
 * same project execute-scene-edit-executor.ts already opened/edited) -
 * this worker never opens a second, separate AE instance for render.
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
      const result = await client.callTool("ae_list_compositions");
      if (!result.ok) {
        return { ok: false, reason: `ae_list_compositions failed: ${result.error.message}` };
      }
      const parsed = parseCompositionList(result.content);
      if (!parsed.ok) {
        return { ok: false, reason: `ae_list_compositions response did not match the confirmed shape: ${parsed.reason}` };
      }

      const atIndex = parsed.value.find((c) => c.index === params.aeProjectItemIndex);
      if (!atIndex) {
        return { ok: false, reason: `aeProjectItemIndex ${params.aeProjectItemIndex} does not resolve to any composition in this project` };
      }
      if (atIndex.name !== params.compositionName) {
        return {
          ok: false,
          reason: `aeProjectItemIndex ${params.aeProjectItemIndex} resolved to composition "${atIndex.name}", expected "${params.compositionName}" - refusing to render the wrong composition`
        };
      }

      const sameName = parsed.value.filter((c) => c.name === params.compositionName);
      if (sameName.length > 1) {
        return {
          ok: false,
          reason: `composition name "${params.compositionName}" is ambiguous - ${sameName.length} compositions in this project share it (indices: ${sameName.map((c) => c.index).join(", ")}) and aerender addresses only by name; refusing to render an ambiguous target`
        };
      }

      return { ok: true };
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
