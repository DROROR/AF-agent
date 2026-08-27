import { z } from "zod";
import type { InspectRenderCapabilitiesResponse } from "@dyo/schemas";
import { buildInspectRenderCapabilitiesScript } from "../jsx-templates.js";
import { HeroicSwanAeMutationClient } from "../heroic-swan-ae-mutation-client.js";
import type { AeMutationClient } from "../ae-edit-bridge.js";
import { unwrapJsxResult } from "../unwrap-jsx-result.js";

const scriptResultSchema = z.union([
  z.object({ ok: z.literal(true), renderSettingsTemplateNames: z.array(z.string()), outputModuleTemplateNames: z.array(z.string()) }).strict(),
  z.object({ ok: z.literal(false), failureReason: z.string() }).strict()
]);

export type InspectRenderCapabilitiesResult =
  | { kind: "capabilities"; response: InspectRenderCapabilitiesResponse }
  | { kind: "failure"; reason: string };

export interface RenderCapabilitiesInspector {
  inspect(): Promise<InspectRenderCapabilitiesResult>;
}

/**
 * Real, production INSPECT_RENDER_CAPABILITIES implementation
 * (render-delivery phase section 10) - reuses the SAME write-capable
 * `ae_run_jsx` channel EXECUTE_FRAME uses (there is no allowlisted
 * read-only ae-mcp tool for this - see jsx-templates.ts's own doc comment
 * on buildInspectRenderCapabilitiesScript), but only ever sends that ONE
 * fixed, reviewed, non-mutating, non-saving script - never an arbitrary
 * one. Never opens/closes a project itself; assumes one is already open,
 * matching every other inspector/bridge in this worker.
 */
export class HeroicSwanRenderCapabilitiesInspector implements RenderCapabilitiesInspector {
  private readonly createMutationClient: () => AeMutationClient;

  constructor(config: { aeMcpPath: string } | { createMutationClient: () => AeMutationClient }) {
    this.createMutationClient =
      "createMutationClient" in config
        ? config.createMutationClient
        : () => new HeroicSwanAeMutationClient({ aeMcpPath: config.aeMcpPath });
  }

  async inspect(): Promise<InspectRenderCapabilitiesResult> {
    const client = this.createMutationClient();
    try {
      await client.connect();
    } catch (error) {
      await client.close();
      return { kind: "failure", reason: `could not connect to ae-mcp: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
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
    } finally {
      await client.close();
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
  async inspect(): Promise<InspectRenderCapabilitiesResult> {
    throw new RenderCapabilitiesInspectorUnavailableError();
  }
}
