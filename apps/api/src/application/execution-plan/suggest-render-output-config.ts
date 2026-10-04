import type { RenderOutputSuggestionResponse, RenderOutputVariant } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";

export interface SuggestRenderOutputConfigDeps {
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
}

/**
 * What a render output could be set up with, WITHOUT anything being guessed
 * (see renderOutputSuggestionResponseSchema for why this exists).
 *
 *  - The master composition: only when this project's own manifest has
 *    exactly one composition that nothing else nests. Two or more is a
 *    choice, and a choice is the person's.
 *  - The two After Effects template names: the ones another project
 *    inspected on the SAME worker is currently configured with, taking the
 *    most recently updated such project. Those names are known to exist on
 *    that machine's After Effects; a name that merely exists on most
 *    installs is not offered.
 *
 * Read-only. It writes nothing - taking the suggestion goes through the same
 * setRenderOutputConfig a person filling in the form uses.
 */
export async function suggestRenderOutputConfig(
  deps: SuggestRenderOutputConfigDeps,
  projectId: string,
  variant: RenderOutputVariant
): Promise<RenderOutputSuggestionResponse> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  const masters = project.manifest.compositions.filter((composition) => !composition.isNestedOnlyReferenced);
  const master = masters.length === 1 ? masters[0] : undefined;
  if (!master || project.sourceWorkerId === null || project.sourceWorkerId === undefined) {
    return { suggestion: null };
  }

  const others = (await deps.projectRepository.findAll())
    .filter((other) => other.id !== project.id && other.sourceWorkerId === project.sourceWorkerId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  for (const other of others) {
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(other.id);
    const config = plan?.renderOutputs[variant] ?? null;
    if (config) {
      return {
        suggestion: {
          manifestCompositionId: master.compositionId,
          compositionName: master.name,
          renderSettingsTemplateName: config.renderSettingsTemplateName,
          outputModuleTemplateName: config.outputModuleTemplateName,
          basedOnProjectName: other.name
        }
      };
    }
  }
  return { suggestion: null };
}
