import { sceneEditResultSchema, type Composition, type JobDto, type TemplateManifest } from "@dyo/schemas";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import { deterministicId } from "../../domain/execution-plan/deterministic-id.js";

export interface RegisterHorizontalCompositionDeps {
  executionSessionRepository: ExecutionSessionRepository;
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
  now: () => Date;
}

/**
 * Landscape output-composition build (live QA, 2026-09-10 urgent request:
 * "COMPLETE THE MISSING OUTPUT-COMPOSITION STAGE") - the exact same
 * "close the last real code gap" pattern as register-reels-composition.ts:
 * once a BUILD_HORIZONTAL_COMPOSITION operation genuinely succeeds, the
 * new composition is registered as an ADDITIVE derived entry on the
 * project's own manifest - so it appears in the EXISTING Render Settings
 * dropdown (which only ever reads `project.manifest.compositions`) and
 * RENDER LANDSCAPE can resolve it through the EXISTING, unmodified
 * render-dispatch pipeline. No new UI, no new render path, no manual
 * DB/curl step.
 *
 * Called after a worker's job-status report has already been durably
 * applied (reportJobStatus succeeded) - never a second, competing write
 * path for the job's own status/result. Runs AFTER
 * recordExecuteFrameResultIfApplicable in routes/jobs.ts, so by the time
 * this reads the session it already reflects this same job's own
 * completion (latestWorkingProjectSha256 already advanced).
 *
 * FAILS CLOSED (does nothing) rather than registering anything if:
 *   - this job's operations didn't produce a horizontalCompositionBuilt
 *     result,
 *   - the session doesn't exist or belongs to a different project (never
 *     a cross-project registration),
 *   - the CURRENT plan's revision no longer matches the session's own
 *     planRevision (the plan moved on since this job was dispatched),
 *   - the session's own latestWorkingProjectSha256 does not match this
 *     job's own produced workingProjectSha256 (a later job already
 *     overtook this one, or this job's own success was never recorded),
 *   - the project's current manifest source sha256 no longer matches this
 *     job's own re-verified sourceProjectSha256 (a fresh INSPECT_TEMPLATE
 *     ran since dispatch).
 *
 * IDEMPOTENT: the derived compositionId is deterministic
 * (project+scenePlanId, never random - a distinct namespace from
 * register-reels-composition.ts's own "reels-composition" prefix so the
 * two derived entries for the same scene can never collide), and
 * registration always replaces any prior entry with that exact id rather
 * than appending a new one - a retried/duplicate report of the same
 * successful job can never produce two manifest entries for the same
 * scene's Landscape composition.
 *
 * The original template's own compositions/scenes are never touched -
 * this only ever ADDS or REPLACES the one derived entry it owns.
 */
export async function registerHorizontalCompositionIfApplicable(deps: RegisterHorizontalCompositionDeps, job: JobDto): Promise<void> {
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
  if (result.failureReason !== null || !result.horizontalCompositionBuilt || !result.workingProjectSha256) {
    return;
  }

  const session = await deps.executionSessionRepository.findById(result.executionSessionId);
  if (!session || session.projectId !== job.projectId) {
    return;
  }
  // Stale working-copy SHA: some other event has already moved the
  // session's own recorded working-copy head away from what THIS job
  // produced - never register against a state the session no longer
  // agrees with.
  if (session.latestWorkingProjectSha256 !== result.workingProjectSha256) {
    return;
  }

  const plan = await deps.executionPlanRepository.findCurrentByProjectId(job.projectId);
  if (!plan || plan.revision !== session.planRevision) {
    return;
  }

  const project = await deps.projectRepository.findById(job.projectId);
  if (!project || project.manifest.sourceProject.sha256 !== result.sourceProjectSha256) {
    return;
  }

  const derivedCompositionId = deterministicId(["horizontal-composition", job.projectId, result.scenePlanId]);
  const derivedComposition: Composition = {
    compositionId: derivedCompositionId,
    aeProjectItemIndex: result.horizontalCompositionBuilt.aeProjectItemIndex,
    name: result.horizontalCompositionBuilt.compositionName,
    widthPx: result.horizontalCompositionBuilt.widthPx,
    heightPx: result.horizontalCompositionBuilt.heightPx,
    durationSeconds: result.horizontalCompositionBuilt.durationSeconds,
    frameRate: result.horizontalCompositionBuilt.frameRate,
    isNestedOnlyReferenced: false,
    parentCompositionIds: []
  };

  const nextManifest: TemplateManifest = {
    ...project.manifest,
    compositions: [...project.manifest.compositions.filter((c) => c.compositionId !== derivedCompositionId), derivedComposition]
  };
  await deps.projectRepository.updateManifest(job.projectId, nextManifest, deps.now());
}
