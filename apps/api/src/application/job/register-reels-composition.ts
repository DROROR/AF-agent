import { sceneEditResultSchema, type Composition, type JobDto, type TemplateManifest } from "@dyo/schemas";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { deterministicId } from "../../domain/execution-plan/deterministic-id.js";

export interface RegisterReelsCompositionDeps {
  executionSessionRepository: ExecutionSessionRepository;
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
  now: () => Date;
}

/**
 * Closes the last real code gap in native Reels output (2026-08-29
 * closure pass, part 2): once a BUILD_REELS_COMPOSITION operation
 * genuinely succeeds, the new composition is registered as an ADDITIVE
 * derived entry on the project's own manifest - so it appears in the
 * EXISTING Render Settings dropdown (which only ever reads
 * `project.manifest.compositions`) and RENDER REELS can resolve it through
 * the EXISTING, unmodified render-dispatch pipeline. No new UI, no new
 * render path, no manual DB/curl step.
 *
 * Called after a worker's job-status report has already been durably
 * applied (reportJobStatus succeeded) - never a second, competing write
 * path for the job's own status/result, mirroring
 * record-execute-frame-result.ts/record-scene-evidence.ts/
 * record-render-artifact.ts's own doc comment verbatim. Runs AFTER
 * recordExecuteFrameResultIfApplicable in routes/jobs.ts, so by the time
 * this reads the session it already reflects this same job's own
 * completion (latestWorkingProjectSha256 already advanced).
 *
 * FAILS CLOSED (does nothing) rather than registering anything if:
 *   - this job's operations didn't produce a reelsCompositionBuilt result,
 *   - the session doesn't exist or belongs to a different project (never
 *     a cross-project registration),
 *   - the CURRENT plan's revision no longer matches the session's own
 *     planRevision (the plan moved on since this scene was dispatched),
 *   - the scene's CURRENT approved reelsLayout no longer matches what was
 *     actually built (an edit landed between dispatch and completion),
 *   - the session's own latestWorkingProjectSha256 does not match this
 *     job's own produced workingProjectSha256 (a later scene already
 *     overtook this one, or this job's own success was never recorded),
 *   - the project's current manifest source sha256 no longer matches this
 *     job's own re-verified sourceProjectSha256 (a fresh INSPECT_TEMPLATE
 *     ran since dispatch).
 *
 * IDEMPOTENT: the derived compositionId is deterministic
 * (project+scenePlanId, never random), and registration always replaces
 * any prior entry with that exact id rather than appending a new one - a
 * retried/duplicate report of the same successful job can never produce
 * two manifest entries for the same scene's Reels composition.
 *
 * The original template's own compositions/scenes are never touched -
 * this only ever ADDS or REPLACES the one derived entry it owns.
 */
export async function registerReelsCompositionIfApplicable(deps: RegisterReelsCompositionDeps, job: JobDto): Promise<void> {
  if (job.operation !== "EXECUTE_FRAME" || job.status !== "SUCCEEDED") {
    return;
  }
  if (!job.projectId) {
    return;
  }

  const parsed = sceneEditResultSchema.safeParse(job.result);
  if (!parsed.success) {
    return;
  }
  const result = parsed.data;
  if (result.failureReason !== null || !result.reelsCompositionBuilt || !result.workingProjectSha256) {
    return;
  }

  const session = await deps.executionSessionRepository.findById(result.executionSessionId);
  if (!session || session.projectId !== job.projectId) {
    return;
  }
  // Stale working-copy SHA: some other event (a later scene, a
  // chain-of-custody failure) has already moved the session's own
  // recorded working-copy head away from what THIS job produced - never
  // register against a state the session no longer agrees with.
  if (session.latestWorkingProjectSha256 !== result.workingProjectSha256) {
    return;
  }

  const plan = await deps.executionPlanRepository.findCurrentByProjectId(job.projectId);
  if (!plan || plan.revision !== session.planRevision) {
    return;
  }
  const scene = plan.scenePlans.find((s) => s.id === result.scenePlanId);
  if (!scene || !scene.reelsLayout || scene.reelsLayout.reelsCompositionName !== result.reelsCompositionBuilt.compositionName) {
    return;
  }

  const project = await deps.projectRepository.findById(job.projectId);
  if (!project || project.manifest.sourceProject.sha256 !== result.sourceProjectSha256) {
    return;
  }

  const derivedCompositionId = deterministicId(["reels-composition", job.projectId, result.scenePlanId]);
  const derivedComposition: Composition = {
    compositionId: derivedCompositionId,
    aeProjectItemIndex: result.reelsCompositionBuilt.aeProjectItemIndex,
    name: result.reelsCompositionBuilt.compositionName,
    widthPx: result.reelsCompositionBuilt.widthPx,
    heightPx: result.reelsCompositionBuilt.heightPx,
    durationSeconds: result.reelsCompositionBuilt.durationSeconds,
    frameRate: result.reelsCompositionBuilt.frameRate,
    isNestedOnlyReferenced: false,
    parentCompositionIds: []
  };

  const nextManifest: TemplateManifest = {
    ...project.manifest,
    compositions: [...project.manifest.compositions.filter((c) => c.compositionId !== derivedCompositionId), derivedComposition]
  };
  await deps.projectRepository.updateManifest(job.projectId, nextManifest, deps.now());
}
