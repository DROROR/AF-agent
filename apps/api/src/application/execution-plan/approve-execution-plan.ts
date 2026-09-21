import { getExecutionPlanReadiness, type ApproveExecutionPlanRequest, type ExecutionPlanResponse } from "@dyo/schemas";
import {
  ExecutionPlanNotFoundError,
  PreconditionNotMetError,
  ProjectNotFoundError,
  SourceShaMismatchError,
  StaleExecutionPlanRevisionError
} from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";
import { validateBrandRules, type BrandRulesConfig } from "../../domain/brand-rules/validate-brand-rules.js";
import { loadBrandRulesConfig } from "../../domain/brand-rules/brand-rules-config.js";
import { describeTemplateCopyBlockers, findTemplateCopyBlockers } from "../../domain/execution-plan/evaluate-template-copy.js";
import { describeSlotBlockers, findSlotBlockers } from "@dyo/schemas";

export interface ApproveExecutionPlanDeps {
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
  /** Stage 4: asset dimensions are part of judging whether an asset belongs in a slot and whether its fit renders correctly. */
  assetRepository: AssetRepository;
  now: () => Date;
  /** Injectable for tests - defaults to reading the real dyo-brand-rules.yaml. */
  brandRulesConfig?: BrandRulesConfig;
}

/**
 * In-place status transition to APPROVED on the CURRENT revision - never
 * creates a new revision, since approving doesn't change content. Refuses
 * if:
 *   - the caller's baseRevision is stale (optimistic concurrency),
 *   - the plan isn't currently DRAFT (only a DRAFT plan is eligible -
 *     REJECTED must be reopened first, and re-"approving" an already
 *     APPROVED plan is refused rather than silently overwriting
 *     approvedAt/approvedBy),
 *   - the plan's own sourceProjectSha256 no longer matches its project's
 *     current manifest sha256 (CLAUDE.md Safety Rule 8 / Phase 4: a plan
 *     built for one source revision must never be approved/executed
 *     against a different one that quietly replaced it),
 *   - any scene marked for use still has an unresolved reason
 *     (getExecutionPlanReadiness - the SAME shared predicate the
 *     dashboard's Overview tab uses, so the UI can never claim a plan is
 *     ready when this would actually refuse it).
 * This is real backend enforcement, not merely a disabled UI button - a
 * direct API call cannot bypass it.
 */
export async function approveExecutionPlan(
  deps: ApproveExecutionPlanDeps,
  projectId: string,
  userId: string,
  request: ApproveExecutionPlanRequest
): Promise<ExecutionPlanResponse> {
  const current = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!current) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  if (current.revision !== request.baseRevision) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }
  if (current.status !== "DRAFT") {
    throw new PreconditionNotMetError(`Plan is ${current.status}, not DRAFT - only a DRAFT plan is eligible for approval`);
  }

  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  if (project.sourceProjectSha256 !== current.sourceProjectSha256) {
    throw new SourceShaMismatchError();
  }

  const readiness = getExecutionPlanReadiness(current.scenePlans);
  if (!readiness.ready) {
    throw new PreconditionNotMetError(
      `Plan is not ready for approval: ${readiness.unresolvedSceneCount} scene(s) marked for use still have an unresolved reason`
    );
  }

  // LEFTOVER TEMPLATE COPY (2026-09-18 real incident): a text mapping that
  // still says exactly what the purchased template said - or differs only in
  // case/whitespace - blocks approval until a human explicitly decides to
  // replace it or to keep the template wording. Silence is never approval.
  // A manifest that never captured the template's own text cannot be checked
  // at all and blocks the same way, naming re-inspection as the fix, rather
  // than passing with a warning nobody reads. Enforced here in the backend,
  // so a direct API call cannot bypass the dashboard's own warnings.
  const templateCopyBlockers = findTemplateCopyBlockers(current.scenePlans, project.manifest);
  if (templateCopyBlockers.length > 0) {
    throw new PreconditionNotMetError(
      `Plan still contains unreviewed template copy: ${describeTemplateCopyBlockers(templateCopyBlockers).join(" | ")}`
    );
  }

  // SLOT SEMANTICS AND FIT (Stage 4): an image slot whose structural
  // classification is uncertain, an asset that does not belong in the slot it
  // is mapped to, or a fit that would stretch/over-crop/letterbox the result
  // all block approval until a human records an explicit decision bound to
  // those exact findings. Backend enforcement, so a direct API call cannot
  // bypass the dashboard's own warnings.
  const slotAssets = new Map(
    (await deps.assetRepository.listByProjectId(projectId)).map((asset) => [asset.id, { id: asset.id, widthPx: asset.width, heightPx: asset.height, hasAlpha: asset.hasAlpha ?? null }])
  );
  const slotBlockers = findSlotBlockers(current.scenePlans, project.manifest, slotAssets);
  if (slotBlockers.length > 0) {
    throw new PreconditionNotMetError(`Plan has unresolved slot findings: ${describeSlotBlockers(slotBlockers).join(" | ")}`);
  }

  // Permanent DYO brand rules (CLAUDE.md) - a hard gate, not merely a
  // disabled UI button, so required brand elements can never silently
  // disappear from an approved plan. See dyo-brand-rules.yaml and
  // validate-brand-rules.ts's own doc comments for exactly what is (and,
  // for the still-unconfigured DYO blue value, is deliberately not yet)
  // enforced here.
  const brandRules = validateBrandRules(current, deps.brandRulesConfig ?? loadBrandRulesConfig());
  if (!brandRules.ok) {
    throw new PreconditionNotMetError(
      `Plan does not satisfy the required DYO brand rules: ${brandRules.violations.map((violation) => violation.message).join(" ")}`
    );
  }

  const now = deps.now();
  const updated = await deps.executionPlanRepository.updateStatus(
    current.id,
    current.revision,
    { status: "APPROVED", approvedAt: now, approvedBy: userId },
    now
  );
  if (!updated) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }
  return toExecutionPlanResponse(updated);
}
