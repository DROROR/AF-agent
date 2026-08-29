import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * Distinguishes a genuine ae-mcp REQUEST TIMEOUT from every other transport
 * failure (CLAUDE.md Safety Rule 9: "pause safely... instead of endless
 * retries"). AE exposes no API this worker can call to directly ask "is a
 * modal dialog open right now" - so this deliberately does NOT claim
 * dedicated modal detection. A timeout on an otherwise-reachable transport
 * is the closest honest, checkable proxy for "AE or the bridge is not
 * responding" - in practice most often caused by exactly a blocking dialog
 * (a missing-font or overwrite-confirmation prompt), but reported as what
 * is actually observed (a timeout), never as a fabricated "modal detected"
 * claim. See docs/RUNBOOK.md's troubleshooting table for the operator-facing
 * version of this same guidance.
 */
export function isMcpTimeout(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

/**
 * Produces the honest, greppable failure text for any ae-mcp transport
 * error - AE_UNRESPONSIVE/BRIDGE_TIMEOUT for a real timeout (the supported
 * practical equivalent of "AE modal suspected" - see CLAUDE.md's own
 * AE_MODAL_SUSPECTED recovery state name), a plain transport-error message
 * otherwise. Every caller already fails this operation closed - the
 * in-flight scene edit's own executor (execute-scene-edit-executor.ts)
 * stops at the first failed operation and never attempts the next one - and
 * the durable per-operation checkpoint already completed is preserved, so a
 * human can safely re-dispatch once AE/the bridge is responsive again (see
 * resolve-resume-checkpoint.ts) without re-running completed work.
 */
export function describeMcpFailure(error: unknown): string {
  if (isMcpTimeout(error)) {
    return (
      "AE_UNRESPONSIVE (BRIDGE_TIMEOUT) - After Effects or the ae-mcp bridge did not respond within the configured timeout. " +
      "This is the closest honest signal this system has for a stuck AE modal dialog (e.g. a missing-font or overwrite-confirmation " +
      "prompt) - AE exposes no API to directly detect one, so this is reported as an unresponsiveness timeout, never as a claimed " +
      "modal detection. NEEDS HUMAN ACTION: check the AE window on the Worker machine for a blocking dialog and resolve it (or " +
      "restart AE if it is genuinely hung), confirm CHECK_HEALTH reports AE and MCP both ONLINE again, then re-dispatch this same " +
      "scene/job - already-completed operations are preserved and will not be re-applied."
    );
  }
  return `ae-mcp transport error: ${error instanceof Error ? error.message : String(error)}`;
}
