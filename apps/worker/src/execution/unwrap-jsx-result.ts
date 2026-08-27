import { z } from "zod";
import { parseJsonTextContent } from "../inspection/parse-mcp-shapes.js";

/**
 * Shared double-JSON-envelope unwrap for any `ae_run_jsx` response (see
 * ae-edit-bridge.ts's own doc comment for the full trace of why this
 * envelope exists - the real upstream host wraps a script's own
 * `JSON.stringify`'d return value as `{result: "<that string>"}` before
 * the MCP text block wraps it again). Used by any FixedJsxScript caller
 * that needs its own result shape, not just EXECUTE_FRAME's mutation
 * scripts - see inspect-render-capabilities.ts.
 */
const hostRunJsxEnvelopeSchema = z.object({ result: z.string() }).strict();

export type UnwrapJsxResult = { ok: true; value: unknown } | { ok: false; reason: string };

export function unwrapJsxResult(content: unknown): UnwrapJsxResult {
  const parsedContent = parseJsonTextContent(content);
  if (!parsedContent.ok) {
    return { ok: false, reason: `ae_run_jsx response did not contain a parseable JSON result: ${parsedContent.reason}` };
  }
  const parsedEnvelope = hostRunJsxEnvelopeSchema.safeParse(parsedContent.value);
  if (!parsedEnvelope.success) {
    return {
      ok: false,
      reason: `ae_run_jsx response did not match the expected host envelope {result: string}: ${parsedEnvelope.error.message}`
    };
  }
  try {
    return { ok: true, value: JSON.parse(parsedEnvelope.data.result) };
  } catch (error) {
    return {
      ok: false,
      reason: `the script's own returned JSON string could not be parsed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
