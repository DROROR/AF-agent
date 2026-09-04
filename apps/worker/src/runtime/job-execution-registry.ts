import type { McpChildOwner, McpChildTerminationOutcome } from "../inspection/heroic-swan-mcp-client.js";

export interface JobExecutionRegistryLogger {
  info: (meta: Record<string, unknown>, message: string) => void;
}

export interface ActiveJobHandle {
  jobId: string;
  operation: string;
}

/**
 * Single source of truth for "what job is the Worker currently executing,
 * and which owned ae-mcp child process(es) belong to it" - maxConcurrency=1
 * (CLAUDE.md) means there is at most one active job at a time, so this
 * tracks exactly one slot rather than a general job-id-keyed map.
 *
 * Real production gap this closes (2026-09-04, job c19a2fb9 stuck RUNNING
 * for 20+ minutes with maxConcurrency=1 blocking every new job): nothing
 * previously tracked which in-flight resources belonged to the currently
 * executing job, so a watchdog or shutdown had no safe way to abort just
 * that job's own owned MCP child process(es) without guessing. Any
 * HeroicSwanMcpClient (or other McpChildOwner) constructed while executing
 * a job MUST register itself here immediately (before connect(), so even
 * a hang during the initial handshake is abortable) and unregister in its
 * own `finally`, regardless of how that job ultimately completes.
 */
export class JobExecutionRegistry {
  private active: ActiveJobHandle | null = null;
  private owners: Set<McpChildOwner> = new Set();

  constructor(private readonly logger?: JobExecutionRegistryLogger) {}

  /** Called once, before a job's own operation handler runs. */
  beginJob(handle: ActiveJobHandle): void {
    this.active = handle;
    this.owners = new Set();
  }

  /** Called once the job has fully settled (any status) - a no-op if a DIFFERENT job is currently active (defensive: never clears state that belongs to a job that started after this one, e.g. if callers race). */
  endJob(jobId: string): void {
    if (this.active?.jobId === jobId) {
      this.active = null;
      this.owners = new Set();
    }
  }

  getActiveJob(): ActiveJobHandle | null {
    return this.active;
  }

  hasActiveJob(): boolean {
    return this.active !== null;
  }

  /** Registers an MCP-child-owning resource as belonging to the currently active job. Returns an unregister function - callers MUST call it once done with the resource (typically their own finally), even if the job was aborted. Safe to call with no active job (e.g. a stray/test construction) - it is simply tracked and can still be terminated. */
  registerMcpOwner(owner: McpChildOwner): () => void {
    this.owners.add(owner);
    return () => {
      this.owners.delete(owner);
    };
  }

  /**
   * Terminates every MCP child owner currently registered for the active
   * job, in parallel, each independently bounded by its own terminate()
   * (never throws). Returns one outcome per owner - callers (a watchdog,
   * or worker shutdown) should treat any "unconfirmed" outcome as reason
   * to hold off declaring the job's slot safely free.
   */
  async abortActiveJob(reason: string): Promise<McpChildTerminationOutcome[]> {
    const owners = [...this.owners];
    this.logger?.info(
      { jobId: this.active?.jobId, operation: this.active?.operation, ownerCount: owners.length, reason },
      "aborting active job - terminating its owned MCP child process(es)"
    );
    const outcomes = await Promise.all(owners.map((owner) => owner.terminate(reason)));
    this.logger?.info(
      { jobId: this.active?.jobId, outcomes },
      "active job abort: owned MCP child process termination complete"
    );
    return outcomes;
  }
}
