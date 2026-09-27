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
      aeProjectItemIndex: 1,
      compositionName: "Scene A",
      layers: [],
      preview: null,
      previewFailureReason: null,
      layerDetails: null,
      layerDetailsFailureReason: null,
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

  /**
   * REAL 2026-09-27 REELS-LAYOUT INCIDENT - the worker's layer scan now
   * carries a measured 1080x1920 layout PROPOSAL alongside the facts it
   * was derived from (scene-evidence.ts). This is the whole path by
   * which that proposal reaches the API and the dashboard, so it is
   * asserted to survive the strict response schema intact rather than
   * being quietly dropped as an unknown key.
   */
  it("stores a result carrying a measured Reels layout proposal, intact, including the layers it refused and why", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    const reelsLayoutProposal = {
      sourceFrame: { widthPx: 1600, heightPx: 900 },
      targetFrame: { widthPx: 1080, heightPx: 1920 },
      backgroundCoverageRatio: 0.85,
      proposals: [
        {
          layerIndex: 3,
          layerName: "a layer",
          role: "BACKGROUND" as const,
          positionX: 0,
          positionY: -1186.667,
          scalePercent: 213.334,
          sourceBounds: { left: 0, top: 0, width: 1600, height: 900 },
          proposedBounds: { left: 0, top: -1186.667, width: 3413.344, height: 1920.006 }
        }
      ],
      refusals: [{ layerIndex: 2, layerName: "another layer", reason: "CAMERA_LAYER" as const, detail: "a camera has no 2D bounding box" }]
    };
    const job = baseJob();

    await recordSceneEvidenceIfApplicable(
      { sceneEvidenceRepository, now: () => NOW },
      { ...job, result: { ...(job.result as Record<string, unknown>), reelsLayoutProposal, reelsLayoutProposalFailureReason: null } }
    );

    const rows = await sceneEvidenceRepository.listLatestByProject(PROJECT_ID);
    expect(rows[0]?.response.reelsLayoutProposal).toEqual(reelsLayoutProposal);
  });

  it("stores a result that carries no proposal at all, unchanged - a worker that predates it is never rejected", async () => {
    const sceneEvidenceRepository = new InMemorySceneEvidenceRepository();
    await recordSceneEvidenceIfApplicable({ sceneEvidenceRepository, now: () => NOW }, baseJob());

    const rows = await sceneEvidenceRepository.listLatestByProject(PROJECT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.response.reelsLayoutProposal ?? null).toBeNull();
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
          aeProjectItemIndex: 1,
          compositionName: "Scene A",
          layers: [],
          preview: null,
          previewFailureReason: null,
          layerDetails: null,
          layerDetailsFailureReason: null,
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
