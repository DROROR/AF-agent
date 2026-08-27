import { randomUUID } from "node:crypto";
import { sceneEvidenceResponseSchema, type JobDto } from "@dyo/schemas";
import type { SceneEvidenceRepository } from "../../domain/scene-evidence/types.js";

export interface RecordSceneEvidenceDeps {
  sceneEvidenceRepository: SceneEvidenceRepository;
  now: () => Date;
}

/**
 * Called after a worker's job-status report has already been durably
 * applied (reportJobStatus succeeded) - never a second, competing write
 * path for the job's own status/result, which remains solely
 * report-job-status.ts's concern. This only ever ADDS a scene_evidence
 * fact record as a side effect of a genuine INSPECT_SCENE_EVIDENCE success;
 * it never changes a job's own state and never throws in a way that could
 * make the caller believe job-status reporting itself failed (evidence
 * persistence being unavailable does not mean the job didn't succeed).
 *
 * Idempotent by construction from two directions: (1) the jobs table's own
 * compare-and-swap status transition means a job can only ever reach
 * SUCCEEDED once, so this is only ever invoked once per real completion;
 * (2) even so, SceneEvidenceRepository.record() is itself idempotent by
 * jobId as defense in depth.
 *
 * Only a job with `status: "SUCCEEDED"`, operation `INSPECT_SCENE_EVIDENCE`,
 * a real `projectId` (see job-dispatch.ts - required for this operation),
 * and a `result` that parses through the SAME strict
 * sceneEvidenceResponseSchema the worker's own contract uses ever produces a
 * record. A malformed, missing, or unattributable result is silently
 * skipped - never partially trusted, never persisted (evidence-persistence
 * phase section 4/9).
 */
export async function recordSceneEvidenceIfApplicable(deps: RecordSceneEvidenceDeps, job: JobDto): Promise<void> {
  if (job.operation !== "INSPECT_SCENE_EVIDENCE" || job.status !== "SUCCEEDED") {
    return;
  }
  if (!job.projectId) {
    return;
  }

  const parsed = sceneEvidenceResponseSchema.safeParse(job.result);
  if (!parsed.success) {
    return;
  }

  await deps.sceneEvidenceRepository.record(
    {
      id: randomUUID(),
      projectId: job.projectId,
      jobId: job.jobId,
      manifestCompositionId: parsed.data.manifestCompositionId,
      sourceProjectSha256: parsed.data.verifiedSourceProjectSha256,
      response: parsed.data,
      capturedAt: new Date(parsed.data.capturedAt)
    },
    deps.now()
  );
}
