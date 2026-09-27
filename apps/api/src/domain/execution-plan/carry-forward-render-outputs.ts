import { EMPTY_RENDER_OUTPUTS, type RenderOutputs } from "@dyo/schemas";

/**
 * What a NEW plan revision starts with in `renderOutputs`, given the
 * revision it supersedes (live QA, 2026-09-27, project
 * c0e422b6-e1d6-4190-a7f9-449b3bf2a99f).
 *
 * THE REAL INCIDENT: LANDSCAPE had been configured through Render
 * Settings and a Landscape video had already rendered from it. The
 * operator then made one unrelated plan edit (SET_REELS_LAYOUT). That
 * edit created revision N+1, which - by the rule this function replaces -
 * started with EMPTY_RENDER_OUTPUTS, so the LANDSCAPE configuration the
 * operator had entered simply vanished. Nothing said so. The only symptom
 * appeared several steps later, from a completely different feature:
 * CREATE_PREVIEW failed with "Landscape output is not configured for this
 * project yet". REELS, configured AFTER that edit, was still there, which
 * made the loss look arbitrary rather than systematic.
 *
 * The rule it replaces was deliberate ("a content edit can change/remove
 * the very composition a prior revision's config pointed at" - the
 * original comment on DrizzleExecutionPlanRepository.createRevision), but
 * it was wrong about what a plan edit can actually do. A plan edit only
 * ever rewrites `scenePlans`. It cannot add, remove or renumber a
 * composition: those come from the PROJECT'S manifest, and a ScenePlanEntry
 * exists for every manifest composition always, "never removed"
 * (scenePlanEntrySchema's own doc comment). So the composition a render
 * output config names is exactly as real after the edit as before it, and
 * discarding the config protected nothing - it only destroyed an explicit
 * human decision as a side effect of an unrelated one.
 *
 * WHAT DOES invalidate a config is a change of the SOURCE .aep itself,
 * which is what `sourceProjectSha256` binds (renderOutputConfigSchema's
 * own doc comment, CLAUDE.md Safety Rule 8). Hence the one guard here: a
 * carry-forward happens only while the new revision stays bound to the
 * same source revision as the one it supersedes. Today every revision
 * after the first copies its predecessor's sha (update-execution-plan.ts),
 * so this always carries; the guard exists so that if a plan is ever
 * rebased onto a re-inspected .aep, the configs are dropped outright
 * rather than silently re-pointed at a template they were never selected
 * against.
 *
 * Deliberately NOT a filter: an entry that is already stale relative to
 * this sha is carried across VERBATIM, stale and all. Quietly deleting it
 * here would turn "this configuration is stale - re-select the master
 * composition before rendering" (resolveRenderDispatch) into the much
 * vaguer "not configured", i.e. exactly the misleading symptom this whole
 * function exists to stop. Judging staleness stays where it already lives:
 * at dispatch, against the plan's own current sha, with a message that
 * says what actually happened.
 */
export function carryForwardRenderOutputs(
  previousRenderOutputs: RenderOutputs,
  previousSourceProjectSha256: string,
  nextSourceProjectSha256: string
): RenderOutputs {
  if (previousSourceProjectSha256 !== nextSourceProjectSha256) {
    return EMPTY_RENDER_OUTPUTS;
  }
  return { ...previousRenderOutputs };
}
