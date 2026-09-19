/**
 * THE WORKER'S PROJECT-STATE LOCK (Stage 3, 2026-09-19).
 *
 * After Effects holds exactly ONE project at a time, so any operation that
 * changes which project is open - every safe inspection, every edit, every
 * render pre-check - is a state transition over a single shared resource. The
 * API already dispatches at most one job per worker (maxConcurrency = 1), but
 * that is an outer guarantee about JOBS, not about the several code paths
 * inside one process that can each decide to open something.
 *
 * REFUSES, NEVER QUEUES. Waiting for the lock would mean an inspection sitting
 * behind a long render and then acting on a project state it sampled minutes
 * earlier. A refusal is honest and immediately actionable; the caller reports
 * BUSY and names what holds it.
 */
export interface ProjectStateLockHandle {
  /** Releases the lock. Safe to call twice - the second call does nothing. */
  release(): void;
}

export type AcquireResult = { ok: true; handle: ProjectStateLockHandle } | { ok: false; heldBy: string; heldSince: Date };

export class ProjectStateLock {
  private holder: { label: string; since: Date; token: symbol } | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Takes the lock for `label`, or refuses with who holds it and since when. */
  acquire(label: string): AcquireResult {
    if (this.holder !== null) {
      return { ok: false, heldBy: this.holder.label, heldSince: this.holder.since };
    }
    const token = Symbol(label);
    this.holder = { label, since: this.now(), token };
    let released = false;
    return {
      ok: true,
      handle: {
        release: () => {
          if (released) {
            return;
          }
          released = true;
          // Only the holder may clear it: a late release from an abandoned
          // operation must never unlock someone else's work.
          if (this.holder?.token === token) {
            this.holder = null;
          }
        }
      }
    };
  }

  /** What holds the lock right now, for diagnostics - never used to make a decision. */
  describeHolder(): { label: string; since: Date } | null {
    return this.holder === null ? null : { label: this.holder.label, since: this.holder.since };
  }
}

/**
 * The one lock this worker process uses. A module-level singleton on purpose:
 * every inspection path must contend for the SAME lock, and injecting a fresh
 * one per call site would silently defeat it (each caller would hold its own).
 * Tests construct their own `ProjectStateLock` and pass it explicitly.
 */
export const workerProjectStateLock = new ProjectStateLock();
