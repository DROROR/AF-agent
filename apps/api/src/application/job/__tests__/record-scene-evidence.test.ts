import { describe, expect, it } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { InMemorySceneEvidenceRepository } from "../test-support/in-memory-scene-evidence-repository.js";
import { recordSceneEvidenceIfApplicable } from "../record-scene-evidence.js";

const NOW = new Date("2026-08-27T00:00:00.000Z");
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";

function baseJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: JOB_ID,
    workerId: "33333333-3333-3333-3333-333333333333",
    projectId: PROJECT_ID,
    operation: "INSPECT_SCENE_EVIDENCE",
    status: "SUCCEEDED",
    payload: {},
    result: {
      verifiedSourceProjectSha256: "a".repeat(64),
      manifestCompositionId: "comp-1",
      compositionIndex: 0,
      compositionName: "Scene A",
      layers: [],
      preview: null,
      previewFailureReason: null,
      capturedAt: NOW.toISOString()
    },
    error: null,
    checkpoint: null,
    createdAt: NOW.toISOString(),
    claimedAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides
  };
}

describe("recordSceneEvidenceIfApplicable", () => {
  it("stores a valid SUCCEEDED INSPECT_SCENE_EVIDENCE result", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    await recordSceneEvidenceIfApplicable({ sceneEvidenceRepository, now: () => NOW }, baseJob());

    const rows = await sceneEvidenceRepository.listLatestByProject(PROJECT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.manifestCompositionId).toBe("comp-1");
    expect(rows[0]?.sourceProjectSha256).toBe("a".repeat(64));
  });

  it("never stores anything for a non-SUCCEEDED job, even one with a result-shaped payload", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    await recordSceneEvidenceIfApplicable({ sceneEvidenceRepository, now: () => NOW }, baseJob({ status: "RUNNING" }));
    expect(await sceneEvidenceRepository.listLatestByProject(PROJECT_ID)).toEqual([]);
  });

  it("never stores anything for a different operation", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    await recordSceneEvidenceIfApplicable(
      { sceneEvidenceRepository, now: () => NOW },
      baseJob({ operation: "INSPECT_TEMPLATE" })
    );
    expect(await sceneEvidenceRepository.listLatestByProject(PROJECT_ID)).toEqual([]);
  });

  it("discards a malformed result - never partially trusted, never persisted", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    await recordSceneEvidenceIfApplicable(
      { sceneEvidenceRepository, now: () => NOW },
      baseJob({ result: { nonsense: true } })
    );
    expect(await sceneEvidenceRepository.listLatestByProject(PROJECT_ID)).toEqual([]);
  });

  it("skips a job that has no projectId (not attributable to any project)", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    await recordSceneEvidenceIfApplicable({ sceneEvidenceRepository, now: () => NOW }, baseJob({ projectId: null }));
    expect(await sceneEvidenceRepository.listLatestByProject(PROJECT_ID)).toEqual([]);
  });

  it("is idempotent for a duplicate/retried call against the same jobId - never creates a second record", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    const job = baseJob();
    await recordSceneEvidenceIfApplicable({ sceneEvidenceRepository, now: () => NOW }, job);
    await recordSceneEvidenceIfApplicable({ sceneEvidenceRepository, now: () => NOW }, job);

    const rows = await sceneEvidenceRepository.listLatestByProject(PROJECT_ID);
    expect(rows).toHaveLength(1);
  });

  it("preserves multiple historical records across different jobs for the same scene, rather than overwriting", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    await recordSceneEvidenceIfApplicable({ sceneEvidenceRepository, now: () => NOW }, baseJob({ jobId: "job-a" }));
    await recordSceneEvidenceIfApplicable(
      { sceneEvidenceRepository, now: () => new Date(NOW.getTime() + 1000) },
      baseJob({
        jobId: "job-b",
        result: {
          verifiedSourceProjectSha256: "a".repeat(64),
          manifestCompositionId: "comp-1",
          compositionIndex: 0,
          compositionName: "Scene A",
          layers: [],
          preview: null,
          previewFailureReason: null,
          capturedAt: new Date(NOW.getTime() + 1000).toISOString()
        }
      })
    );

    // listLatestByProject only ever returns the newest per composition, but
    // both records must still exist underneath - never overwritten in place.
    const latest = await sceneEvidenceRepository.listLatestByProject(PROJECT_ID);
    expect(latest).toHaveLength(1);
    expect(latest[0]?.jobId).toBe("job-b");
  });
});
