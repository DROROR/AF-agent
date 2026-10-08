import type { RenderOutputSuggestionResponse, RenderOutputVariant } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";

/**
 * The Render Settings and Output Module templates After Effects installs with,
 * by their exact names (seen in the Render Queue of every AE 2026 install this
 * project has met, and listed by INSPECT_RENDER_CAPABILITIES on 2026-09-17 -
 * docs/ACCEPTANCE.md). The Output Module is the H.264 one because the complete
 * preview and the render are written as .mp4.
 *
 * REAL 2026-10-08 (client project 3241977f): the client's first project on his
 * machine had no sibling to copy names from, so the full form was shown; he
 * typed a name that does not exist in After Effects and picked one scene as
 * the master, and the render failed with "No render settings template was
 * found". Then the form was gone (it hides once something is saved) and he
 * had nowhere to put it right. These names are offered when no sibling
 * project has names of its own; a sibling's names still come first.
 */
export const AFTER_EFFECTS_BUILT_IN_RENDER_TEMPLATES = {
  renderSettingsTemplateName: "Best Settings",
  outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps"
} as const;

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
  if (!master) {
    return { suggestion: null };
  }
  if (project.sourceWorkerId === null || project.sourceWorkerId === undefined) {
    return builtIn(master);
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
  return builtIn(master);
}

function builtIn(master: { compositionId: string; name: string }): RenderOutputSuggestionResponse {
  return {
    suggestion: {
      manifestCompositionId: master.compositionId,
      compositionName: master.name,
      ...AFTER_EFFECTS_BUILT_IN_RENDER_TEMPLATES,
      basedOnProjectName: null
    }
  };
}
