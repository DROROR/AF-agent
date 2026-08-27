import { describe, expect, it } from "vitest";
import {
  JOB_STATUS_TRANSITIONS,
  TERMINAL_JOB_STATUSES,
  claimJobResponseSchema,
  jobDtoSchema,
  reportJobStatusRequestSchema
} from "../job.js";
import { hasJobPayloadSchema, validateJobPayload } from "../job-payload.js";

function validJobDto() {
  return {
    jobId: "11111111-1111-1111-1111-111111111111",
    workerId: "22222222-2222-2222-2222-222222222222",
    projectId: null,
    operation: "INSPECT_TEMPLATE",
    status: "QUEUED",
    payload: { templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" },
    result: null,
    error: null,
    checkpoint: null,
    createdAt: new Date().toISOString(),
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date().toISOString()
  };
}

describe("jobDtoSchema", () => {
  it("accepts a valid queued job", () => {
    expect(() => jobDtoSchema.parse(validJobDto())).not.toThrow();
  });

  it("rejects an operation outside WORKER_CAPABILITIES - never an arbitrary command string", () => {
    const dto = { ...validJobDto(), operation: "rm -rf /" };
    expect(() => jobDtoSchema.parse(dto)).toThrow();
  });

  it("rejects a status outside the fixed enum", () => {
    const dto = { ...validJobDto(), status: "RUNNING_FOREVER" };
    expect(() => jobDtoSchema.parse(dto)).toThrow();
  });
});

describe("JOB_STATUS_TRANSITIONS", () => {
  it("allows QUEUED -> CLAIMED", () => {
    expect(JOB_STATUS_TRANSITIONS.QUEUED).toContain("CLAIMED");
  });

  it("never allows a transition out of a terminal status", () => {
    for (const status of TERMINAL_JOB_STATUSES) {
      expect(JOB_STATUS_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("never allows QUEUED to jump directly to SUCCEEDED, skipping the machine states", () => {
    expect(JOB_STATUS_TRANSITIONS.QUEUED).not.toContain("SUCCEEDED");
  });
});

describe("claimJobResponseSchema", () => {
  it("accepts a null job (nothing queued for this worker)", () => {
    expect(() => claimJobResponseSchema.parse({ job: null })).not.toThrow();
  });

  it("accepts a claimed job", () => {
    const dto = { ...validJobDto(), status: "CLAIMED", claimedAt: new Date().toISOString() };
    expect(() => claimJobResponseSchema.parse({ job: dto })).not.toThrow();
  });
});

describe("reportJobStatusRequestSchema", () => {
  it("accepts a minimal RUNNING report", () => {
    expect(() => reportJobStatusRequestSchema.parse({ status: "RUNNING" })).not.toThrow();
  });

  it("accepts a FAILED report with a typed error", () => {
    const body = { status: "FAILED", error: { code: "NOT_AVAILABLE", message: "no bridge yet" } };
    expect(() => reportJobStatusRequestSchema.parse(body)).not.toThrow();
  });

  it("rejects an error object with a code outside JOB_ERROR_CODES", () => {
    const body = { status: "FAILED", error: { code: "WHATEVER", message: "x" } };
    expect(() => reportJobStatusRequestSchema.parse(body)).toThrow();
  });
});

describe("job payload validation (operation-specific, never arbitrary)", () => {
  it("has a registered payload schema for INSPECT_TEMPLATE", () => {
    expect(hasJobPayloadSchema("INSPECT_TEMPLATE")).toBe(true);
  });

  it("validates a correct INSPECT_TEMPLATE payload", () => {
    const result = validateJobPayload("INSPECT_TEMPLATE", {
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep"
    });
    expect(result).toEqual({ templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" });
  });

  it("rejects an INSPECT_TEMPLATE payload missing required fields", () => {
    expect(() => validateJobPayload("INSPECT_TEMPLATE", { templateId: "tmpl-1" })).toThrow();
  });

  it("throws for an operation with no registered payload schema, rather than silently accepting anything", () => {
    expect(() => validateJobPayload("RENDER", { anything: "goes" })).toThrow();
  });
});
