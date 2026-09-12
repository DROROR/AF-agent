"use client";

import {
  READ_ONLY_DIAGNOSTIC_KINDS,
  runDiagnosticResponseSchema,
  type JobDto,
  type ReadOnlyDiagnosticKind,
  type RunDiagnosticResponse,
  type WorkerDto
} from "@dyo/schemas";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { dispatchJob, fetchJobStatus } from "../lib/projects-api-client";

/**
 * Remote Windows diagnostics, in the dashboard (2026-09-12).
 *
 * Every incident on this project so far has been diagnosed by an operator
 * pasting PowerShell output into a chat window. This panel runs the same
 * evidence gathering over the worker's existing outbound channel: it
 * dispatches an allowlisted diagnostic job and renders the result the worker
 * reports back. No inbound connection, no shell box, no path field - the
 * operator picks from a fixed list and that is the entire input surface.
 */

const POLL_INTERVAL_MS = 2_000;
/** Generous: a diagnostic is only claimed on the worker's next heartbeat tick, so the floor is one heartbeat interval, not one round trip. */
const POLL_TIMEOUT_MS = 90_000;

const KIND_LABELS: Record<ReadOnlyDiagnosticKind, string> = {
  GET_WORKER_LOG_TAIL: "Worker log (tail)",
  GET_PREVIOUS_WORKER_LOG: "Previous worker log",
  GET_DYO_PROCESS_TREE: "DYO process tree",
  GET_DISK_SPACE: "Disk space",
  GET_AE_MCP_HEALTH: "AE / ae-mcp health",
  GET_ACTIVE_JOB_DETAILS: "Active job details",
  GET_JOB_ARTIFACTS: "Job artifacts"
};

type PanelState =
  | { phase: "idle" }
  | { phase: "running"; kind: ReadOnlyDiagnosticKind; jobId: string | null }
  | { phase: "done"; kind: ReadOnlyDiagnosticKind; response: RunDiagnosticResponse }
  | { phase: "error"; kind: ReadOnlyDiagnosticKind; message: string };

export interface WorkerDiagnosticsPanelProps {
  worker: WorkerDto;
}

export function WorkerDiagnosticsPanel({ worker }: WorkerDiagnosticsPanelProps): ReactElement {
  const [state, setState] = useState<PanelState>({ phase: "idle" });
  const [jobIdInput, setJobIdInput] = useState("");
  // Guards every setState after an await: the drawer can close (unmounting
  // this panel) while a diagnostic is still polling, and updating state then
  // is both useless and a React warning.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (kind: ReadOnlyDiagnosticKind) => {
      setState({ phase: "running", kind, jobId: null });

      const dispatched = await dispatchJob({
        operation: "RUN_DIAGNOSTIC",
        workerId: worker.workerId,
        payload: {
          kind,
          ...(kind === "GET_JOB_ARTIFACTS" && jobIdInput.trim() ? { jobId: jobIdInput.trim() } : {})
        }
      });
      if (!mountedRef.current) {
        return;
      }
      if (!dispatched.ok) {
        setState({ phase: "error", kind, message: dispatched.message });
        return;
      }

      const jobId = dispatched.data.jobId;
      setState({ phase: "running", kind, jobId });

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (!mountedRef.current) {
          return;
        }
        const job = await fetchJobStatus(jobId);
        if (!mountedRef.current) {
          return;
        }
        if (!job.ok) {
          // A transient read failure must not end the poll - the same defect
          // fixed in the New Project wizard on 2026-09-11, where one failed
          // fetch permanently stopped a still-valid poll.
          continue;
        }
        const settled = settleDiagnostic(kind, job.data);
        if (settled) {
          setState(settled);
          return;
        }
      }
      setState({
        phase: "error",
        kind,
        message: `The worker did not report a result within ${POLL_TIMEOUT_MS / 1000}s. The job may still be queued - check Jobs / Queue.`
      });
    },
    [jobIdInput, worker.workerId]
  );

  const busy = state.phase === "running";

  return (
    <section className="diagnostics-panel">
      <h3 className="diagnostics-panel__title">Remote diagnostics</h3>
      <p className="field__hint">
        Runs an allowlisted, read-only check on {worker.name} over its existing outbound connection. No shell access, no
        file paths, and secrets are redacted on the worker before anything is sent.
      </p>

      <div className="diagnostics-panel__actions">
        {READ_ONLY_DIAGNOSTIC_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="button button--secondary"
            disabled={busy || (kind === "GET_JOB_ARTIFACTS" && jobIdInput.trim() === "")}
            onClick={() => {
              void run(kind);
            }}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="field__label">Job ID (for &ldquo;Job artifacts&rdquo;)</span>
        <input
          className="field__input"
          value={jobIdInput}
          onChange={(event) => setJobIdInput(event.target.value)}
          placeholder="48bf41d3-153d-472a-af2f-207ded38bbad"
          disabled={busy}
        />
      </label>

      <DiagnosticResult state={state} />
    </section>
  );
}

/**
 * Turns a polled job into a settled panel state, or null while it is still
 * in flight. Exported for testing - this is where a worker's honest
 * `ok: false` must stay visible rather than being flattened into a generic
 * failure.
 */
export function settleDiagnostic(kind: ReadOnlyDiagnosticKind, job: JobDto): PanelState | null {
  if (job.status === "SUCCEEDED" || job.status === "FAILED") {
    const parsed = runDiagnosticResponseSchema.safeParse(job.result);
    if (parsed.success) {
      return { phase: "done", kind, response: parsed.data };
    }
    return {
      phase: "error",
      kind,
      message: job.error?.message ?? "The worker returned a result that did not match the diagnostic contract"
    };
  }
  if (job.status === "CANCELLED") {
    return { phase: "error", kind, message: "This diagnostic was cancelled before it ran" };
  }
  return null;
}

function DiagnosticResult({ state }: { state: PanelState }): ReactElement | null {
  if (state.phase === "idle") {
    return null;
  }
  if (state.phase === "running") {
    return (
      <p role="status" className="field__hint">
        Waiting for {KIND_LABELS[state.kind]}
        {state.jobId ? ` (job ${state.jobId})` : ""}&hellip; the worker picks this up on its next heartbeat.
      </p>
    );
  }
  if (state.phase === "error") {
    return (
      <p role="alert" className="form-error">
        {KIND_LABELS[state.kind]} failed: {state.message}
      </p>
    );
  }

  const { response } = state;
  return (
    <div className="diagnostics-panel__result">
      <p className="field__hint">
        Captured {new Date(response.capturedAt).toLocaleString()}
        {response.ok ? "" : " — the worker could not gather this evidence"}
      </p>
      {!response.ok && response.failureReason ? <p role="alert" className="form-error">{response.failureReason}</p> : null}

      {response.text ? (
        <>
          {response.text.note ? <p className="field__hint">{response.text.note}</p> : null}
          {response.text.truncated ? <p className="field__hint">Output was truncated — oldest lines dropped.</p> : null}
          <pre className="diagnostics-panel__log">{response.text.lines.join("\n") || "(no lines)"}</pre>
        </>
      ) : null}

      {response.processes ? (
        <table className="table">
          <thead>
            <tr>
              <th>PID</th>
              <th>Parent</th>
              <th>Role</th>
              <th>Command</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {response.processes.map((process) => (
              <tr key={process.processId}>
                <td>{process.processId}</td>
                <td>{process.parentProcessId ?? "—"}</td>
                <td>{process.role}</td>
                <td><code>{process.commandLineSummary}</code></td>
                <td>{process.startedAt ? new Date(process.startedAt).toLocaleTimeString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {response.disks ? (
        <ul>
          {response.disks.map((disk) => (
            <li key={disk.path}>
              <code>{disk.path}</code> — {formatGb(disk.freeBytes)} free of {formatGb(disk.totalBytes)}
              {disk.note ? ` (${disk.note})` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {response.detail ? <pre className="diagnostics-panel__log">{JSON.stringify(response.detail, null, 2)}</pre> : null}
    </div>
  );
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
