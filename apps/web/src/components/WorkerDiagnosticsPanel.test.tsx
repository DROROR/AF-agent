import type { JobDto } from "@dyo/schemas";
import { describe, expect, it } from "vitest";
import { settleDiagnostic } from "./WorkerDiagnosticsPanel";

function job(overrides: Partial<JobDto>): JobDto {
  return {
    jobId: "48bf41d3-153d-472a-af2f-207ded38bbad",
    workerId: "accd0a71-dbd6-4a53-8b81-d3fe4609420b",
    projectId: null,
    operation: "RUN_DIAGNOSTIC",
    status: "QUEUED",
    payload: { kind: "GET_WORKER_LOG_TAIL" },
    result: null,
    error: null,
    checkpoint: null,
    createdAt: "2026-09-12T14:30:00.000Z",
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-09-12T14:30:00.000Z",
    ...overrides
  } as JobDto;
}

const successfulResult = {
  kind: "GET_WORKER_LOG_TAIL",
  capturedAt: "2026-09-12T14:31:00.000Z",
  workerId: "accd0a71-dbd6-4a53-8b81-d3fe4609420b",
  ok: true,
  failureReason: null,
  text: { path: "C:\\DYO-Agent\\app\\logs\\worker.log", lines: ["heartbeat succeeded"], truncated: false, note: null }
};

describe("settleDiagnostic", () => {
  it("stays in flight while the job is QUEUED or RUNNING", () => {
    expect(settleDiagnostic("GET_WORKER_LOG_TAIL", job({ status: "QUEUED" }))).toBeNull();
    expect(settleDiagnostic("GET_WORKER_LOG_TAIL", job({ status: "RUNNING" }))).toBeNull();
    expect(settleDiagnostic("GET_WORKER_LOG_TAIL", job({ status: "CLAIMED" }))).toBeNull();
  });

  it("settles with the parsed evidence on success", () => {
    const settled = settleDiagnostic("GET_WORKER_LOG_TAIL", job({ status: "SUCCEEDED", result: successfulResult }));
    expect(settled).toMatchObject({ phase: "done" });
  });

  // A FAILED diagnostic still carries the worker's own structured reason -
  // showing the generic job failure instead would throw away the only useful
  // thing the operator asked for.
  it("keeps the worker's own evidence visible on a FAILED diagnostic", () => {
    const failedResult = { ...successfulResult, ok: false, failureReason: "tasklist did not settle", text: undefined };
    const settled = settleDiagnostic("GET_DYO_PROCESS_TREE", job({ status: "FAILED", result: failedResult }));
    expect(settled).toMatchObject({ phase: "done" });
    expect((settled as { response: { failureReason: string } }).response.failureReason).toBe("tasklist did not settle");
  });

  it("falls back to the job error when the result does not match the contract", () => {
    const settled = settleDiagnostic(
      "GET_WORKER_LOG_TAIL",
      job({ status: "FAILED", result: { unexpected: true }, error: { code: "NOT_AVAILABLE", message: "no diagnostics in this build" } })
    );
    expect(settled).toMatchObject({ phase: "error", message: "no diagnostics in this build" });
  });

  it("reports a cancelled diagnostic rather than polling forever", () => {
    expect(settleDiagnostic("GET_WORKER_LOG_TAIL", job({ status: "CANCELLED" }))).toMatchObject({ phase: "error" });
  });
});
