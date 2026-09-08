import { z } from "zod";
import type { SceneEditOperation, SceneEditOperationType } from "@dyo/schemas";
import { parseJsonTextContent } from "../inspection/parse-mcp-shapes.js";
import { windowsPathsEqual } from "../inspection/canonical-windows-path.js";
import { buildOperationScript, buildOpenProjectScript, buildSaveProjectScript, type FixedJsxScript } from "./jsx-templates.js";
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

/** What buildOpenProjectScript's own JSON.stringify(...) result actually contains on success - see that function's own doc comment. */
const openProjectResultValueSchema = z
  .object({
    openedPath: z.string().nullable(),
    openedName: z.string().nullable()
  })
  .strict();

export type OpenProjectResult = { ok: true; openedPath: string } | { ok: false; failureReason: string };

/**
 * Applies allowlisted SceneEditOperations, and saves, the AE project
 * currently open through ae-mcp.
 *
 * CRITICAL SAFETY FIX (live QA, 2026-09-08, real incident): this class
 * previously never opened/closed a project itself, on the stated
 * assumption that execute-scene-edit-executor.ts (or an earlier
 * INSPECT_TEMPLATE-style flow) already had the right project open - that
 * assumption was never actually enforced anywhere, and a real
 * EXECUTE_FRAME job proved it wrong: AE still had the IMMUTABLE SOURCE
 * .aep open (from an earlier, unrelated read-only inspection job), and
 * `applyOperation`/`saveProject` mutated and saved THAT instead of the
 * intended session working copy - a direct CLAUDE.md Safety Rule 1
 * violation ("never overwrite the original .aep"). `openProject` below
 * closes this gap: execute-scene-edit-executor.ts now calls it with the
 * session's own real working-copy path BEFORE any operation is ever
 * attempted, and refuses to proceed unless AE's own self-reported open
 * project path matches it exactly (canonical Windows path comparison,
 * never a name-only guess) - see that function's own doc comment for the
 * full verification.
 */
export interface AeEditBridge {
  /**
   * Ensures EXACTLY `expectedPath` is open in AE before anything else runs
   * - reuses buildOpenProjectScript verbatim (the SAME fixed, versioned,
   * already-shipped script INSPECT_TEMPLATE's own ensureTargetProjectOpen
   * uses), then independently verifies AE's own self-reported opened path
   * (never merely that `app.open()` didn't throw) against `expectedPath`
   * via windowsPathsEqual - a case-insensitive, separator-normalized
   * comparison, since both are real Windows filesystem paths. Fails
   * closed (never proceeds) if AE reports any other path, or none at all.
   */
  openProject(expectedPath: string): Promise<OpenProjectResult>;
  applyOperation(params: { aeProjectItemIndex: number; compositionName: string; operation: SceneEditOperation }): Promise<OperationExecutionResult>;
  /** Saves the currently-open project IN PLACE (the working copy - see buildSaveProjectScript's own doc comment for why this can never reach the original source, and openProject's own doc comment for why that guarantee now actually holds). */
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
  async openProject(_expectedPath: string): Promise<OpenProjectResult> {
    throw new AeMutationTransportUnavailableError();
  }
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

  async openProject(expectedPath: string): Promise<OpenProjectResult> {
    const script = buildOpenProjectScript(expectedPath);
    const outcome = await this.runScript(script);
    if (!outcome.ok) {
      return { ok: false, failureReason: outcome.failureReason };
    }
    const parsed = openProjectResultValueSchema.safeParse(outcome.resultingValue);
    if (!parsed.success) {
      return {
        ok: false,
        failureReason: `open-project script's result did not match the expected {openedPath, openedName} shape: ${parsed.error.message}`
      };
    }
    if (!windowsPathsEqual(parsed.data.openedPath, expectedPath)) {
      return {
        ok: false,
        failureReason: `AE reports "${parsed.data.openedPath ?? "no project"}" is open, not the requested working copy ("${expectedPath}") - refusing to proceed`
      };
    }
    return { ok: true, openedPath: parsed.data.openedPath as string };
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
