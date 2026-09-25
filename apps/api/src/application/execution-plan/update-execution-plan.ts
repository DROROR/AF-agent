import { randomUUID } from "node:crypto";
import type { ExecutionPlanResponse, UpdateExecutionPlanRequest } from "@dyo/schemas";
import { ExecutionPlanEditError, ExecutionPlanNotFoundError, ProjectNotFoundError, StaleExecutionPlanRevisionError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import type { SceneEvidencePreviewRepository } from "../../domain/scene-evidence-preview/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { findOwnedAsset } from "../asset/find-owned-asset.js";
import { applyExecutionPlanEdit } from "./apply-execution-plan-edit.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";
import type { TemplateManifest } from "@dyo/schemas";
import { assessMappingSlot, slotEvidenceDigest, type SlotAssetFacts } from "@dyo/schemas";

export interface UpdateExecutionPlanDeps {
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  /** Optional (unlike executionPlanRepository/assetRepository above) - only actually read for an ADD_MAPPING operation carrying a humanNestedTarget (real-composition-chain verification, live QA brand-rule blocker fix 2026-09-08); every other operation never touches it, and the real production route (routes/projects.ts) always supplies it regardless - kept optional here so every existing test double that never exercises ADD_MAPPING stays valid unchanged. */
  projectRepository?: ProjectRepository;
  /** Optional in the same way - read only by SET_SLOT_REVIEW, which needs the real captured evidence frame to verify a decision against. The production route always supplies it. */
  sceneEvidencePreviewRepository?: SceneEvidencePreviewRepository;
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
  request: UpdateExecutionPlanRequest,
  /** The authenticated user making the edit - recorded on operations that store an attributable human decision (SET_TEMPLATE_TEXT_DECISION). Optional so existing callers keep working; those operations refuse rather than record an unattributable decision. */
  editedBy?: string
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

  // The manifest is REQUIRED for an ADD_MAPPING with a humanNestedTarget
  // (real-composition-chain verification). It is also consulted - whenever a
  // project repository is wired - for the four edits that have no nested
  // form, so an edit to a placeholder that lives inside a precomp is refused
  // the moment the operator makes it, rather than only at dispatch after the
  // plan has already been approved (code review finding, 2026-09-13: those
  // edit-time checks in apply-execution-plan-edit.ts previously never ran in
  // production, because this was the only place a manifest was loaded and it
  // only did so for the nested ADD_MAPPING case). Dispatch still refuses
  // independently, so a caller with no repository loses only the early
  // refusal, never correctness.
  const nestedSensitiveEditTypes: ReadonlySet<string> = new Set([
    "SET_BRAND_COLOR",
    "SET_LAYER_VISIBILITY",
    "SET_TIME_REMAP_FREEZE",
    "SET_LAYER_DURATION"
  ]);
  const requiresManifest = request.operations.some((operation) => operation.type === "ADD_MAPPING" && operation.humanNestedTarget != null);
  const benefitsFromManifest = request.operations.some((operation) => nestedSensitiveEditTypes.has(operation.type));
  if (requiresManifest && !deps.projectRepository) {
    throw new Error("ADD_MAPPING with humanNestedTarget requires UpdateExecutionPlanDeps.projectRepository, which was not supplied");
  }
  let currentManifest;
  if ((requiresManifest || benefitsFromManifest) && deps.projectRepository) {
    const project = await deps.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    currentManifest = project.manifest;
  }

  // STAGE 4: a slot review is bound to the findings it was made about. The
  // digest is computed HERE, from live plan/manifest/asset state, so a caller
  // can never attach a decision to findings the reviewer never saw.
  const needsSlotEvidence = request.operations.some((operation) => operation.type === "SET_SLOT_REVIEW");
  let slotAssets: ReadonlyMap<string, SlotAssetFacts> = new Map();
  let slotManifest: TemplateManifest | undefined = currentManifest;
  if (needsSlotEvidence) {
    if (!deps.projectRepository) {
      throw new Error("SET_SLOT_REVIEW requires UpdateExecutionPlanDeps.projectRepository, which was not supplied");
    }
    const project = await deps.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    slotManifest = project.manifest;
    slotAssets = new Map(
      (await deps.assetRepository.listByProjectId(projectId)).map((asset) => [asset.id, {
        id: asset.id,
        widthPx: asset.width,
        heightPx: asset.height,
        hasAlphaChannel: asset.hasAlphaChannel ?? null,
        hasTransparentPixels: asset.hasTransparentPixels ?? null,
        transparentPixelRatio: asset.transparentPixelRatio ?? null,
        visibleCoverageRatio: asset.visibleCoverageRatio ?? null,
        visibleContentBounds: asset.visibleContentBounds ?? null
      }])
    );
  }

  let scenePlans = current.scenePlans;
  for (const operation of request.operations) {
    let slotEvidenceDigestForOperation: string | undefined;
    if (operation.type === "SET_SLOT_REVIEW" && slotManifest) {
      const scene = scenePlans.find((candidate) => candidate.id === operation.scenePlanId);
      const mapping = scene?.mappings.find((candidate) => candidate.id === operation.mappingId);
      if (scene && mapping) {
        const asset = mapping.selectedAssetId === null ? null : (slotAssets.get(mapping.selectedAssetId) ?? null);
        const assessment = assessMappingSlot({ scene, mapping, manifest: slotManifest, asset });
        slotEvidenceDigestForOperation = slotEvidenceDigest(assessment);

        // MANDATORY EVIDENCE FRAME (Stage 4): a reviewer deciding about a
        // classification, a compatibility conflict or an unsafe fit must have
        // SEEN the slot. The decision is refused without the frame they were
        // shown - a decision made from a description is not evidence.
        const needsFrame = assessment.blockers.some((blocker) => blocker.requiresEvidenceFrame);
        if (needsFrame && operation.evidenceFrameStorageKey === undefined && editedBy !== undefined && editedBy.trim() !== "") {
          throw new ExecutionPlanEditError(
            "this slot decision requires the evidence frame the reviewer was shown - capture it first (the scene-evidence inspection renders the moment the slot is visible), then record the decision with it"
          );
        }
        const unprovable = assessment.blockers.filter((blocker) => blocker.requiresEvidenceFrame && blocker.evidenceFrameAtSeconds === null);
        if (unprovable.length > 0) {
          throw new ExecutionPlanEditError(
            "this slot never presents a moment where it is provably visible, so no evidence frame can show it - fix the layer's timing in the template, or remove this mapping, rather than deciding blind"
          );
        }

        // The frame is verified, not taken on trust: it must be a real
        // capture this system recorded, of THIS scene's composition, from
        // the source the plan is bound to, at a moment the slot was genuinely
        // on screen. Anything else is a reference to a picture nobody can
        // prove shows the slot.
        // An unattributable decision is refused by applyExecutionPlanEdit
        // below, which owns that rule - checking the frame first would answer
        // a narrower question before the more fundamental one.
        const attributable = editedBy !== undefined && editedBy.trim() !== "";
        if (attributable && needsFrame && operation.evidenceFrameStorageKey !== undefined) {
          if (!deps.sceneEvidencePreviewRepository) {
            throw new Error("SET_SLOT_REVIEW requires UpdateExecutionPlanDeps.sceneEvidencePreviewRepository, which was not supplied");
          }
          // PER SLOT, not per composition (real 2026-09-24 defect - see the
          // 2026-09-24 section of docs/ACCEPTANCE.md). This used to ask for
          // the composition's single most recent frame, which quietly made a
          // multi-slot scene impossible to review in one pass: every slot has
          // its OWN visible moment (selectEvidenceFrameSeconds), so capturing
          // slot B's frame superseded the frame slot A's pending decision
          // named, and the only sequence that worked was capture-save-
          // capture-save, one slot at a time. A scene with three slots
          // needing decisions could not be completed through the dashboard at
          // all. Asking per slot lets each slot hold its own current frame at
          // the same time, and supersession still applies WITHIN a slot: a
          // fresher capture for THIS mapping still invalidates the one this
          // decision names. See findLatestForSlot's own contract for why a
          // frame belonging to another mapping is never accepted here, and
          // why a capture taken before slot attribution existed still is.
          const captured = await deps.sceneEvidencePreviewRepository.findLatestForSlot(projectId, scene.manifestCompositionId, operation.mappingId);
          if (!captured || captured.storageKey !== operation.evidenceFrameStorageKey) {
            throw new ExecutionPlanEditError(
              "the evidence frame this decision names is not this slot's most recent captured frame - capture the slot's own moment again and decide about what it shows"
            );
          }
          if (captured.sourceProjectSha256 !== current.sourceProjectSha256) {
            throw new ExecutionPlanEditError(
              "the evidence frame was captured from a different version of the template than this plan is bound to - capture it again before deciding"
            );
          }
          const window = assessment.blockers.find((blocker) => blocker.evidenceFrameWindowSeconds !== null)?.evidenceFrameWindowSeconds ?? null;
          const at = captured.capturedAtSeconds;
          if (at === null || (window !== null && (at < window.startSeconds || at > window.endSeconds))) {
            throw new ExecutionPlanEditError(
              "the evidence frame does not show a moment this slot is on screen, so it proves nothing about it - capture a frame inside the slot's own visible window"
            );
          }
        }
      }
    }
    const result = applyExecutionPlanEdit(scenePlans, operation, deps.now, currentManifest, editedBy, slotEvidenceDigestForOperation);
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
