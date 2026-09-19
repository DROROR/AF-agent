import { z } from "zod";
import type { InspectRenderCapabilitiesRequest, InspectRenderCapabilitiesResponse } from "@dyo/schemas";
import { buildInspectRenderCapabilitiesScript } from "../jsx-templates.js";
import { HeroicSwanAeMutationClient } from "../heroic-swan-ae-mutation-client.js";
import type { AeMutationClient } from "../ae-edit-bridge.js";
import { unwrapJsxResult } from "../unwrap-jsx-result.js";
import { withDisposableProject } from "../../inspection/disposable-project.js";

const scriptResultSchema = z.union([
  z.object({ ok: z.literal(true), renderSettingsTemplateNames: z.array(z.string()), outputModuleTemplateNames: z.array(z.string()) }).strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

export type InspectRenderCapabilitiesResult =
  | { kind: "capabilities"; response: InspectRenderCapabilitiesResponse }
  | { kind: "failure"; reason: string };

export interface RenderCapabilitiesInspector {
  inspect(request?: InspectRenderCapabilitiesRequest): Promise<InspectRenderCapabilitiesResult>;
}

/**
 * Real, production INSPECT_RENDER_CAPABILITIES implementation
 * (render-delivery phase section 10) - reuses the SAME write-capable
 * `ae_run_jsx` channel EXECUTE_FRAME uses (there is no allowlisted
 * read-only ae-mcp tool for this - see jsx-templates.ts's own doc comment
 * on buildInspectRenderCapabilitiesScript), but only ever sends that ONE
 * fixed, reviewed, non-mutating, non-saving script - never an arbitrary
 * one.
 *
 * STAGE 3 (2026-09-19): this inspection OPENS a project, because reading
 * "whatever After Effects happens to be holding" is exactly how the
 * 2026-09-18 incident left a session's working copy open and modified. It now
 * runs through the shared disposable-project wrapper like every other
 * project-opening inspection: a copy beside the named project is opened, the
 * templates are read from it, and the copy is closed and removed while
 * whatever After Effects held before is restored untouched.
 */
export class HeroicSwanRenderCapabilitiesInspector implements RenderCapabilitiesInspector {
  private readonly createMutationClient: () => AeMutationClient;

  constructor(config: { aeMcpPath: string } | { createMutationClient: () => AeMutationClient }) {
    this.createMutationClient =
      "createMutationClient" in config
        ? config.createMutationClient
        : () => new HeroicSwanAeMutationClient({ aeMcpPath: config.aeMcpPath });
  }

  async inspect(request?: InspectRenderCapabilitiesRequest): Promise<InspectRenderCapabilitiesResult> {
    // Stage 3: an inspection that opens a project must name one. An older API
    // that dispatches this with an empty payload fails closed here rather than
    // inspecting whatever happens to be open.
    if (!request?.sourceProjectPath || !request.sourceProjectSha256) {
      return {
        kind: "failure",
        reason:
          "no project was named for this render-capability inspection - it opens a project to read the render-queue templates, and this worker never inspects whatever After Effects happens to be holding. Re-dispatch from a project (the API supplies its path and sha256)."
      };
    }
    const client = this.createMutationClient();
    try {
      await client.connect();
    } catch (error) {
      await client.close();
      return { kind: "failure", reason: `could not connect to ae-mcp: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      const safe = await withDisposableProject(
        {
          runScript: async (script) => {
            const outcome = await client.runFixedOperation(script);
            if (!outcome.ok) {
              return { ok: false, reason: `${outcome.error.code}: ${outcome.error.message}` };
            }
            const unwrappedScript = unwrapJsxResult(outcome.content);
            return unwrappedScript.ok ? { ok: true, value: unwrappedScript.value } : { ok: false, reason: unwrappedScript.reason };
          }
        },
        {
          operation: "INSPECT_RENDER_CAPABILITIES",
          targetPath: request.sourceProjectPath,
          targetSha256: request.sourceProjectSha256,
          sourceProjectPath: request.sourceProjectPath,
          sourceProjectSha256: request.sourceProjectSha256
        },
        async () => this.readTemplates(client)
      );
      if (!safe.ok) {
        return { kind: "failure", reason: `${safe.code}: ${safe.reason}` };
      }
      return safe.value.kind === "capabilities"
        ? { kind: "capabilities", response: { ...safe.value.response, safeInspection: safe.evidence } }
        : safe.value;
    } finally {
      await client.close();
    }
  }

  /** Reads the render-queue template names from the project that is already open - the disposable copy, never the original. */
  private async readTemplates(client: AeMutationClient): Promise<InspectRenderCapabilitiesResult> {
    {
      const script = buildInspectRenderCapabilitiesScript();
      const callResult = await client.runFixedOperation(script);
      if (!callResult.ok) {
        return { kind: "failure", reason: `${callResult.error.code}: ${callResult.error.message}` };
      }

      const unwrapped = unwrapJsxResult(callResult.content);
      if (!unwrapped.ok) {
        return { kind: "failure", reason: unwrapped.reason };
      }

      const parsed = scriptResultSchema.safeParse(unwrapped.value);
      if (!parsed.success) {
        return { kind: "failure", reason: `script result did not match the expected shape: ${parsed.error.message}` };
      }
      if (!parsed.data.ok) {
        return { kind: "failure", reason: parsed.data.failureReason };
      }

      return {
        kind: "capabilities",
        response: {
          aeVersion: null, // Not determinable from this script alone - never guessed (see ae_health for the one real aeVersion source, a separate allowlisted tool this operation does not call).
          renderSettingsTemplateNames: parsed.data.renderSettingsTemplateNames,
          outputModuleTemplateNames: parsed.data.outputModuleTemplateNames,
          capturedAt: new Date().toISOString()
        }
      };
    }
  }
}

export class RenderCapabilitiesInspectorUnavailableError extends Error {
  constructor(reason?: string) {
    super(reason ?? "INSPECT_RENDER_CAPABILITIES cannot run: no real ae-mcp transport is configured (AE_MCP_PATH is unset).");
    this.name = "RenderCapabilitiesInspectorUnavailableError";
  }
}

/** Honest stub - never fabricates a result. */
export class NotAvailableRenderCapabilitiesInspector implements RenderCapabilitiesInspector {
  async inspect(_request?: InspectRenderCapabilitiesRequest): Promise<InspectRenderCapabilitiesResult> {
    throw new RenderCapabilitiesInspectorUnavailableError();
  }
}
