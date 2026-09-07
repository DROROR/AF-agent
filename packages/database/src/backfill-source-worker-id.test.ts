import { describe, expect, it } from "vitest";
import { computeSourceWorkerIdBackfillPlan } from "./backfill-source-worker-id.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const WORKER_QA = "accd0a71-dbd6-4a53-8b81-d3fe4609420b";
const WORKER_OTHER = "99999999-9999-9999-9999-999999999999";

describe("computeSourceWorkerIdBackfillPlan (live QA Blocker 1, section 3)", () => {
  it("matches a project to the one Worker whose SUCCEEDED INSPECT_TEMPLATE result manifest sha256 equals the project's own sourceProjectSha256", () => {
    const plan = computeSourceWorkerIdBackfillPlan(
      [{ projectId: "proj-1", sourceProjectSha256: SHA_A }],
      [{ workerId: WORKER_QA, resultManifestSha256: SHA_A }]
    );
    expect(plan).toEqual([{ projectId: "proj-1", outcome: "MATCH", workerId: WORKER_QA }]);
  });

  it("never invents provenance: reports NO_MATCH (never a guess) when no job's result sha256 equals the project's", () => {
    const plan = computeSourceWorkerIdBackfillPlan(
      [{ projectId: "proj-1", sourceProjectSha256: SHA_A }],
      [{ workerId: WORKER_QA, resultManifestSha256: SHA_B }]
    );
    expect(plan).toEqual([{ projectId: "proj-1", outcome: "NO_MATCH" }]);
  });

  it("reports AMBIGUOUS (never picks one) when more than one distinct Worker's SUCCEEDED job matches the same sha256", () => {
    const plan = computeSourceWorkerIdBackfillPlan(
      [{ projectId: "proj-1", sourceProjectSha256: SHA_A }],
      [
        { workerId: WORKER_QA, resultManifestSha256: SHA_A },
        { workerId: WORKER_OTHER, resultManifestSha256: SHA_A }
      ]
    );
    expect(plan).toEqual([{ projectId: "proj-1", outcome: "AMBIGUOUS", candidateWorkerIds: [WORKER_QA, WORKER_OTHER] }]);
  });

  it("is not confused by the SAME Worker having dispatched the matching job more than once (e.g. re-inspected) - still a clean single MATCH", () => {
    const plan = computeSourceWorkerIdBackfillPlan(
      [{ projectId: "proj-1", sourceProjectSha256: SHA_A }],
      [
        { workerId: WORKER_QA, resultManifestSha256: SHA_A },
        { workerId: WORKER_QA, resultManifestSha256: SHA_A }
      ]
    );
    expect(plan).toEqual([{ projectId: "proj-1", outcome: "MATCH", workerId: WORKER_QA }]);
  });

  it("evaluates each candidate project independently", () => {
    const plan = computeSourceWorkerIdBackfillPlan(
      [
        { projectId: "proj-1", sourceProjectSha256: SHA_A },
        { projectId: "proj-2", sourceProjectSha256: SHA_B }
      ],
      [{ workerId: WORKER_QA, resultManifestSha256: SHA_A }]
    );
    expect(plan).toEqual([
      { projectId: "proj-1", outcome: "MATCH", workerId: WORKER_QA },
      { projectId: "proj-2", outcome: "NO_MATCH" }
    ]);
  });

  it("returns an empty plan for an empty candidate list", () => {
    expect(computeSourceWorkerIdBackfillPlan([], [{ workerId: WORKER_QA, resultManifestSha256: SHA_A }])).toEqual([]);
  });
});
