import { randomUUID } from "node:crypto";
import { renderProjectResultSchema, type JobDto } from "@dyo/schemas";
import type { RenderArtifactRepository } from "../../domain/render-artifact/types.js";
import type { RenderArtifactUploadRepository } from "../../domain/render-artifact-upload/types.js";

export interface RecordRenderArtifactDeps {
  renderArtifactRepository: RenderArtifactRepository;
  renderArtifactUploadRepository: RenderArtifactUploadRepository;
  now: () => Date;
}

/**
 * Called after a worker's job-status report has already been durably
 * applied (reportJobStatus succeeded) - never a second, competing write
 * path for the job's own status/result, mirroring
 * record-scene-evidence.ts's own doc comment exactly (same rationale
 * applies verbatim to RENDER/render_artifacts). Only a job with
 * `status: "SUCCEEDED"`, operation `RENDER`, a real `projectId`, and a
 * `result` that parses through the SAME strict renderProjectResultSchema
 * the worker's own contract uses - AND whose `artifact` is non-null with
 * `validationStatus: "VALID"` - ever produces a record. A result with a
 * null/invalid artifact is never partially trusted, never persisted
 * (render-engine phase section 10/11: "never mark successful before
 * artifact validation").
 *
 * ADDITIONALLY (render-delivery phase section 4/5): a render_artifacts row
 * is only ever created once a MATCHING render_artifact_uploads row already
 * exists for this jobId - i.e. the worker must have already uploaded real,
 * server-verified bytes (see upload-render-artifact.ts) before this ever
 * runs. The worker's own code is what guarantees upload-before-report
 * ordering; if a SUCCEEDED report somehow arrives with no matching upload
 * on record, this silently skips (same "never partially trusted" contract
 * as a malformed result) rather than persisting metadata describing bytes
 * that were never actually verified to exist in storage.
 */
export async function recordRenderArtifactIfApplicable(deps: RecordRenderArtifactDeps, job: JobDto): Promise<void> {
  if (job.operation !== "RENDER" || job.status !== "SUCCEEDED") {
    return;
  }
  if (!job.projectId) {
    return;
  }

  const parsed = renderProjectResultSchema.safeParse(job.result);
  if (!parsed.success) {
    return;
  }
  const artifact = parsed.data.artifact;
  if (!artifact || artifact.validationStatus !== "VALID") {
    return;
  }

  const upload = await deps.renderArtifactUploadRepository.findByJobId(job.jobId);
  if (!upload) {
    return;
  }

  await deps.renderArtifactRepository.record(
    {
      id: randomUUID(),
      projectId: job.projectId,
      jobId: job.jobId,
      variant: artifact.variant,
      compositionName: artifact.compositionName,
      workingProjectSha256: artifact.workingProjectSha256,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      // Prefer the upload's own server-verified byteSize/storageKey/sha256
      // over the worker's self-reported artifact.byteSize - the upload
      // record is independently verified from real written bytes, the
      // worker's own value is not.
      byteSize: upload.byteSize,
      storageKey: upload.storageKey,
      sha256: upload.sha256,
      renderStartedAt: new Date(artifact.renderStartedAt),
      renderCompletedAt: new Date(artifact.renderCompletedAt),
      aerenderExitCode: artifact.aerenderExitCode,
      logExcerpt: artifact.logExcerpt
    },
    deps.now()
  );
}
