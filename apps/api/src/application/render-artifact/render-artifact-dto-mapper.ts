import type { RenderArtifactDto } from "@dyo/schemas";
import type { RenderArtifactRecord } from "../../domain/render-artifact/types.js";

/** Never includes logExcerpt/any filesystem path - see render-artifact/types.ts's own doc comment. */
export function toRenderArtifactDto(record: RenderArtifactRecord): RenderArtifactDto {
  return {
    id: record.id,
    projectId: record.projectId,
    jobId: record.jobId,
    variant: record.variant,
    compositionName: record.compositionName,
    workingProjectSha256: record.workingProjectSha256,
    filename: record.filename,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    sha256: record.sha256,
    renderStartedAt: record.renderStartedAt.toISOString(),
    renderCompletedAt: record.renderCompletedAt.toISOString(),
    aerenderExitCode: record.aerenderExitCode,
    validationStatus: record.validationStatus,
    createdAt: record.createdAt.toISOString()
  };
}
