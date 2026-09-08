import { randomUUID } from "node:crypto";
import type { ExecutionPlanResponse, UpdateExecutionPlanRequest } from "@dyo/schemas";
import { ExecutionPlanEditError, ExecutionPlanNotFoundError, ProjectNotFoundError, StaleExecutionPlanRevisionError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { findOwnedAsset } from "../asset/find-owned-asset.js";
import { applyExecutionPlanEdit } from "./apply-execution-plan-edit.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";

export interface UpdateExecutionPlanDeps {
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  /** Optional (unlike executionPlanRepository/assetRepository above) - only actually read for an ADD_MAPPING operation carrying a humanNestedTarget (real-composition-chain verification, live QA brand-rule blocker fix 2026-09-08); every other operation never touches it, and the real production route (routes/projects.ts) always supplies it regardless - kept optional here so every existing test double that never exercises ADD_MAPPING stays valid unchanged. */
  projectRepository?: ProjectRepository;
  now: () => Date;
}

/**
 * Applies one or more typed edit operations as a single new revision.
 * Never mutates in place (execution_plans is append-only for content -
 * see packages/database/src/schema.ts). Always resets status to DRAFT on
 * the new revision, even if the plan was APPROVED/REJECTED before this
 * edit - Phase 4's own hard rule: "Do not allow an edited plan to remain
 * silently APPROVED."
 *
 * Every MAP_ASSET operation's selectedAssetId is verified against the
 * real Asset Catalog BEFORE any operation is applied - it must exist AND
 * belong to this exact project (asset-workmap-intake phase requirement:
 * "no arbitrary asset IDs, no cross-project assets"). A bad reference
 * fails the whole update; nothing is partially applied.
 */
export async function updateExecutionPlan(
  deps: UpdateExecutionPlanDeps,
  projectId: string,
  request: UpdateExecutionPlanRequest
): Promise<ExecutionPlanResponse> {
  const current = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!current) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  if (current.revision !== request.baseRevision) {
    throw new StaleExecutionPlanRevisionError(request.baseRevision, current.revision);
  }

  for (const operation of request.operations) {
    if (operation.type === "MAP_ASSET") {
      await findOwnedAsset(deps.assetRepository, projectId, operation.selectedAssetId);
    }
  }

  // Only fetched when actually needed (an ADD_MAPPING with a
  // humanNestedTarget - real-composition-chain verification) - every
  // other edit never touches the project/manifest at all.
  const needsManifest = request.operations.some((operation) => operation.type === "ADD_MAPPING" && operation.humanNestedTarget != null);
  let currentManifest;
  if (needsManifest) {
    if (!deps.projectRepository) {
      throw new Error("ADD_MAPPING with humanNestedTarget requires UpdateExecutionPlanDeps.projectRepository, which was not supplied");
    }
    const project = await deps.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    currentManifest = project.manifest;
  }

  let scenePlans = current.scenePlans;
  for (const operation of request.operations) {
    const result = applyExecutionPlanEdit(scenePlans, operation, deps.now, currentManifest);
    if (!result.ok) {
      throw new ExecutionPlanEditError(result.reason);
    }
    scenePlans = result.scenePlans;
  }

  const record = await deps.executionPlanRepository.createRevision(
    {
      id: randomUUID(),
      projectId,
      revision: current.revision + 1,
      status: "DRAFT",
      templateId: current.templateId,
      sourceProjectSha256: current.sourceProjectSha256,
      scenePlans,
      approvedAt: null,
      approvedBy: null
    },
    deps.now()
  );

  return toExecutionPlanResponse(record);
}
