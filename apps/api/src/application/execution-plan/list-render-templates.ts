import { inspectRenderCapabilitiesResponseSchema, type RenderTemplatesResponse } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";

export interface ListRenderTemplatesDeps {
  projectRepository: ProjectRepository;
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
}

/**
 * The Render Queue template names the project's own worker's After Effects
 * last reported - read from that worker's newest SUCCEEDED
 * INSPECT_RENDER_CAPABILITIES job, never from a built-in list or a guess.
 * Null when there is no such report yet. Read-only.
 *
 * REAL 2026-10-21 (client project b48ddc7a): the template names were typed
 * by hand; an Output Module name the machine's After Effects did not have
 * failed only at render time, twice.
 */
export async function listRenderTemplates(deps: ListRenderTemplatesDeps, projectId: string): Promise<RenderTemplatesResponse> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  const workerId = project.sourceWorkerId ?? null;
  if (workerId === null) {
    return { templates: null };
  }
  const job = await deps.jobRepository.findLatestSucceededForWorkerOperation(workerId, "INSPECT_RENDER_CAPABILITIES");
  if (!job) {
    return { templates: null };
  }
  const parsed = inspectRenderCapabilitiesResponseSchema.safeParse(job.result);
  if (!parsed.success) {
    return { templates: null };
  }
  const worker = await deps.workerRepository.findById(workerId);
  return {
    templates: {
      workerId,
      workerName: worker?.name ?? null,
      capturedAt: parsed.data.capturedAt,
      renderSettingsTemplateNames: parsed.data.renderSettingsTemplateNames,
      outputModuleTemplateNames: parsed.data.outputModuleTemplateNames
    }
  };
}
