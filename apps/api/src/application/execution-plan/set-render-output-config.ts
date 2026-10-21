import type { ExecutionPlanResponse, RenderOutputConfig, RenderOutputVariant, SetRenderOutputConfigRequest } from "@dyo/schemas";
import { ExecutionPlanEditError, ExecutionPlanNotFoundError, ProjectNotFoundError, SourceShaMismatchError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";
import { listRenderTemplates, type ListRenderTemplatesDeps } from "./list-render-templates.js";

export interface SetRenderOutputConfigDeps {
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
  now: () => Date;
  /**
   * When given, a template name the project's worker's After Effects has not
   * reported is refused at save time, with the real names in the message -
   * never discovered only when aerender fails (2026-10-21). Without it (or
   * while that worker has never reported its templates) the names are saved
   * as typed.
   */
  renderTemplates?: Pick<ListRenderTemplatesDeps, "jobRepository" | "workerRepository">;
}

/**
 * Explicit, human-confirmed render-output configuration (render-delivery
 * phase section 1/2/3) - an in-place update on the plan's CURRENT
 * revision, never a new revision (choosing a render target is not scene
 * CONTENT requiring re-approval - see DrizzleExecutionPlanRepository's own
 * doc comment on updateRenderOutput).
 *
 * `aeProjectItemIndex`/`compositionName` are NEVER accepted from the
 * request - only `manifestCompositionId` is (section 2: "Do not allow
 * arbitrary numeric index entry"). The server independently resolves
 * those two fields from the PROJECT'S OWN CURRENT manifest, the only
 * authoritative source for "what compositions genuinely exist and what
 * their real aeProjectItemIndex/name currently are" - a request naming an
 * unknown/stale manifestCompositionId is refused outright, never silently
 * substituted with a guess.
 *
 * Fails closed (section 3) if the plan's own bound sourceProjectSha256 no
 * longer matches the project's current manifest sha256 - the exact same
 * check approveExecutionPlan.ts already performs before allowing approval,
 * reused here for the identical reason (CLAUDE.md Safety Rule 8).
 */
export async function setRenderOutputConfig(
  deps: SetRenderOutputConfigDeps,
  projectId: string,
  variant: RenderOutputVariant,
  request: SetRenderOutputConfigRequest
): Promise<ExecutionPlanResponse> {
  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!plan) {
    throw new ExecutionPlanNotFoundError(projectId);
  }

  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (project.sourceProjectSha256 !== plan.sourceProjectSha256) {
    throw new SourceShaMismatchError();
  }

  const composition = project.manifest.compositions.find((c) => c.compositionId === request.manifestCompositionId);
  if (!composition) {
    throw new ExecutionPlanEditError(
      `manifestCompositionId "${request.manifestCompositionId}" does not match any composition in this project's current manifest`
    );
  }

  if (deps.renderTemplates) {
    const { templates } = await listRenderTemplates({ projectRepository: deps.projectRepository, ...deps.renderTemplates }, projectId);
    if (templates) {
      const unknown: string[] = [];
      if (!templates.renderSettingsTemplateNames.includes(request.renderSettingsTemplateName)) {
        unknown.push(`a Render Settings template named "${request.renderSettingsTemplateName}" (it has: ${templates.renderSettingsTemplateNames.join(", ")})`);
      }
      if (!templates.outputModuleTemplateNames.includes(request.outputModuleTemplateName)) {
        unknown.push(`an Output Module template named "${request.outputModuleTemplateName}" (it has: ${templates.outputModuleTemplateNames.join(", ")})`);
      }
      if (unknown.length > 0) {
        const where = templates.workerName ? `After Effects on ${templates.workerName}` : "After Effects on the project's editing computer";
        throw new ExecutionPlanEditError(`${where} does not have ${unknown.join(", nor ")}. Choose a name from its own list, or read the list again under Tools and diagnostics.`);
      }
    }
  }

  const config: RenderOutputConfig = {
    manifestCompositionId: composition.compositionId,
    aeProjectItemIndex: composition.aeProjectItemIndex,
    compositionName: composition.name,
    sourceProjectSha256: plan.sourceProjectSha256,
    renderSettingsTemplateName: request.renderSettingsTemplateName,
    outputModuleTemplateName: request.outputModuleTemplateName,
    configuredAt: deps.now().toISOString()
  };

  const updated = await deps.executionPlanRepository.updateRenderOutput(plan.id, variant, config, deps.now());
  if (!updated) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  return toExecutionPlanResponse(updated);
}
