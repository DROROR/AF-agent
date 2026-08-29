import { z } from "zod";
import type { SceneEditOperation, SceneEditOperationType } from "@dyo/schemas";
import { parseJsonTextContent } from "../inspection/parse-mcp-shapes.js";
import { buildOperationScript, buildSaveProjectScript, type FixedJsxScript } from "./jsx-templates.js";
import { HeroicSwanAeMutationClient, type MutationCallResult } from "./heroic-swan-ae-mutation-client.js";
import { describeMcpFailure } from "./classify-mcp-failure.js";

/** The minimal shape HeroicSwanAeEditBridge needs from a mutation client - HeroicSwanAeMutationClient's real implementation satisfies this; tests inject a fake one instead of spawning a real ae-mcp process. */
export interface AeMutationClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  runFixedOperation(script: FixedJsxScript): Promise<MutationCallResult>;
}

/** What every jsx-templates.ts script's final JSON.stringify(...) call actually produces - see that file's own doc comment. */
const scriptResultSchema = z
  .object({
    ok: z.boolean(),
    previousValue: z.unknown().optional(),
    resultingValue: z.unknown().optional(),
    failureReason: z.string().optional()
  })
  .strict();

/**
 * The real upstream `ae_run_jsx` host dispatch (verified 2026-08-27 from
 * host-scripts/ae-mcp-methods.jsx's `system.runJsx` case) wraps whatever
 * `code` returns as `{ result: <return value> }` BEFORE the MCP text
 * block wraps that again as JSON - a double envelope, not a single one.
 * Since every jsx-templates.ts script's own return value is itself a
 * `JSON.stringify(...)` string, `result` here is always a string that
 * still needs its OWN `JSON.parse` to reach the actual
 * {ok, previousValue, ...} shape.
 */
const hostRunJsxEnvelopeSchema = z.object({ result: z.string() }).strict();

export interface OperationExecutionSuccess {
  ok: true;
  operationType: SceneEditOperationType;
  previousValue: unknown;
  resultingValue: unknown;
}

export interface OperationExecutionFailure {
  ok: false;
  operationType: SceneEditOperationType;
  failureReason: string;
}

export type OperationExecutionResult = OperationExecutionSuccess | OperationExecutionFailure;

export type SaveProjectResult = { ok: true; resultingValue: unknown } | { ok: false; failureReason: string };

/**
 * Applies allowlisted SceneEditOperations, and saves, the AE project
 * currently open through ae-mcp - never opens/closes a project itself
 * (that is execute-scene-edit-executor.ts's responsibility, matching how
 * INSPECT_TEMPLATE/INSPECT_SCENE_EVIDENCE also assume a project is
 * already open).
 */
export interface AeEditBridge {
  applyOperation(params: { aeProjectItemIndex: number; compositionName: string; operation: SceneEditOperation }): Promise<OperationExecutionResult>;
  /** Saves the currently-open project IN PLACE (the working copy - see buildSaveProjectScript's own doc comment for why this can never reach the original source). */
  saveProject(): Promise<SaveProjectResult>;
}

export class AeMutationTransportUnavailableError extends Error {
  constructor(reason?: string) {
    super(reason ?? "EXECUTE_FRAME cannot mutate AE: no real ae-mcp transport is configured (AE_MCP_PATH is unset).");
    this.name = "AeMutationTransportUnavailableError";
  }
}

/** Honest stub - never fabricates a mutation result. Mirrors NotAvailableTemplateInspector's own contract. */
export class NotAvailableAeEditBridge implements AeEditBridge {
  async applyOperation(_params: { aeProjectItemIndex: number; compositionName: string; operation: SceneEditOperation }): Promise<OperationExecutionResult> {
    throw new AeMutationTransportUnavailableError();
  }
  async saveProject(): Promise<SaveProjectResult> {
    throw new AeMutationTransportUnavailableError();
  }
}

export class HeroicSwanAeEditBridge implements AeEditBridge {
  private readonly createMutationClient: () => AeMutationClient;

  constructor(config: { aeMcpPath: string } | { createMutationClient: () => AeMutationClient }) {
    this.createMutationClient =
      "createMutationClient" in config
        ? config.createMutationClient
        : () => new HeroicSwanAeMutationClient({ aeMcpPath: config.aeMcpPath });
  }

  async applyOperation({
    aeProjectItemIndex,
    compositionName,
    operation
  }: {
    aeProjectItemIndex: number;
    compositionName: string;
    operation: SceneEditOperation;
  }): Promise<OperationExecutionResult> {
    const script = buildOperationScript(aeProjectItemIndex, compositionName, operation);
    const outcome = await this.runScript(script);
    if (!outcome.ok) {
      return { ok: false, operationType: operation.type, failureReason: outcome.failureReason };
    }
    return { ok: true, operationType: operation.type, previousValue: outcome.previousValue ?? null, resultingValue: outcome.resultingValue ?? null };
  }

  async saveProject(): Promise<SaveProjectResult> {
    const script = buildSaveProjectScript();
    const outcome = await this.runScript(script);
    if (!outcome.ok) {
      return { ok: false, failureReason: outcome.failureReason };
    }
    return { ok: true, resultingValue: outcome.resultingValue ?? null };
  }

  /** Shared connect/run/parse/close pipeline for any FixedJsxScript - the one place that owns the mutation client's lifecycle. */
  private async runScript(
    script: FixedJsxScript
  ): Promise<{ ok: true; previousValue?: unknown; resultingValue?: unknown } | { ok: false; failureReason: string }> {
    const client = this.createMutationClient();
    try {
      await client.connect();
    } catch (error) {
      await client.close();
      // A connect-time timeout is classified the same honest way as an
      // in-call timeout (see classify-mcp-failure.ts) - AE/ae-mcp not even
      // accepting a new connection within the timeout is the same
      // "unresponsive" signal, just observed earlier in the lifecycle.
      return { ok: false, failureReason: `could not connect to ae-mcp: ${describeMcpFailure(error)}` };
    }

    try {
      const callResult = await client.runFixedOperation(script);
      if (!callResult.ok) {
        return { ok: false, failureReason: `${callResult.error.code}: ${callResult.error.message}` };
      }

      const parsedContent = parseJsonTextContent(callResult.content);
      if (!parsedContent.ok) {
        return { ok: false, failureReason: `ae_run_jsx response did not contain a parseable JSON result: ${parsedContent.reason}` };
      }

      const parsedEnvelope = hostRunJsxEnvelopeSchema.safeParse(parsedContent.value);
      if (!parsedEnvelope.success) {
        return {
          ok: false,
          failureReason: `ae_run_jsx response did not match the expected host envelope {result: string}: ${parsedEnvelope.error.message}`
        };
      }

      let innerResult: unknown;
      try {
        innerResult = JSON.parse(parsedEnvelope.data.result);
      } catch (error) {
        return {
          ok: false,
          failureReason: `the script's own returned JSON string could not be parsed: ${error instanceof Error ? error.message : String(error)}`
        };
      }

      const parsedResult = scriptResultSchema.safeParse(innerResult);
      if (!parsedResult.success) {
        return {
          ok: false,
          failureReason: `the script's own result did not match the expected {ok, previousValue, resultingValue, failureReason} shape: ${parsedResult.error.message}`
        };
      }

      const scriptResult = parsedResult.data;
      if (!scriptResult.ok) {
        return { ok: false, failureReason: scriptResult.failureReason ?? "the AE-side script reported failure with no reason given" };
      }

      return { ok: true, previousValue: scriptResult.previousValue, resultingValue: scriptResult.resultingValue };
    } finally {
      await client.close();
    }
  }
}
