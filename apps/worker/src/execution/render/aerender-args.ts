/**
 * Builds the ONE allowlisted `aerender` argument array this worker will
 * ever spawn (CLAUDE.md: "Final render: aerender.exe, separate from
 * editing operations"; render-engine phase section 3: "no arbitrary shell
 * commands... allowlisted arguments only"). Every value here is either a
 * fixed, hardcoded flag/verbosity constant or one of this narrow params
 * object's own already-validated fields - there is no free-form
 * string concatenation and no shell involved at all (see
 * aerender-runner.ts's own `spawn(..., { shell: false })`).
 *
 * This is the ONE canonical builder both CREATE_PREVIEW
 * (create-full-preview-executor.ts) and RENDER (render-project-executor.ts)
 * already share via aerender-runner.ts - never a second, divergent
 * argument-construction path for either operation.
 *
 * Real, stable, Adobe-documented aerender CLI flags (unchanged across AE
 * versions, including 2026):
 *   -project <path>            the .aep to open (always the WORKING COPY)
 *   -comp <name>               the composition to render, by NAME (aerender
 *                              has no index-based addressing option at all -
 *                              see verify-render-composition.ts for how this
 *                              worker independently proves that name is
 *                              unambiguous and belongs to the intended
 *                              composition BEFORE ever reaching this builder)
 *   -RStemplate <name>         a named Render Settings template already
 *                              saved in the project/OS - never guessed
 *   -OMtemplate <name>         a named Output Module template (determines
 *                              the actual output container/codec - see
 *                              render-project-executor.ts's own doc comment
 *                              on why this is NOT assumed to be H.264/MP4
 *                              without real client-machine verification)
 *   -output <path>             this worker's own deterministic, job-scoped
 *                              output path - never a caller-supplied path
 *   -close DO_NOT_SAVE_CHANGES  aerender must never re-save the working
 *                              copy after rendering - rendering is
 *                              read-only with respect to project state
 *                              (CLAUDE.md Safety Rule 5: editing and
 *                              rendering are separate stages)
 *   -v ERRORS_AND_PROGRESS     real 2026-09-10 incident fix (job
 *                              ea99c6dd-359d-4c02-ab3b-01687a1d8cf3, AE
 *                              26.3x87): the PRIOR value here,
 *                              "ERRORS_AND_WARNINGS", is not a value AE's
 *                              own aerender actually recognizes - a real
 *                              client run failed immediately with
 *                              "aerender SYNTAX ERROR: Bad value for
 *                              -verbose." (AE's own error text refers to
 *                              this flag by its long name even though -v
 *                              is the form passed here). ERRORS_AND_PROGRESS
 *                              is Adobe's own documented, real value -
 *                              fixed, moderate log verbosity: never ALL
 *                              (unbounded chatter) and never SILENT (no
 *                              troubleshooting signal).
 *   -s <startFrame>            real 2026-09-10 incident fix (session
 *   -e <endFrame>              a7fee3d9): without explicit -s/-e, aerender
 *                              falls back to whatever "Time Span" the
 *                              named Render Settings template itself
 *                              specifies - for "Best Settings" on this
 *                              real project that turned out to be "Work
 *                              Area Only", and the real work area
 *                              (31.7317s) is narrower than the
 *                              composition's own real duration (45.045s),
 *                              silently truncating every render. `-s`/`-e`
 *                              are real, stable, Adobe-documented aerender
 *                              flags that explicitly override the
 *                              template's own Time Span for this one
 *                              invocation - always the composition's own
 *                              full, real, freshly-verified frame range
 *                              (startFrame 0 through the last real frame),
 *                              computed by the caller from
 *                              CompositionVerifier's own real
 *                              durationSeconds/frameRate (verify-render-
 *                              composition.ts) - never a guessed or
 *                              caller-supplied span, and never a change to
 *                              the project's own AE work-area setting
 *                              itself (this is a render-invocation
 *                              argument only, read-only with respect to
 *                              project state).
 */
export interface AerenderArgsParams {
  projectPath: string;
  compName: string;
  renderSettingsTemplateName: string;
  outputModuleTemplateName: string;
  outputPath: string;
  /** 0-based, always 0 for a full-composition render - see this module's own doc comment on -s/-e above. */
  startFrame: number;
  /** 0-based, INCLUSIVE - the composition's own real last frame (Math.round(durationSeconds * frameRate) - 1), never the work area's own end. */
  endFrame: number;
}

/**
 * Real 2026-09-10 incident fix (session a7fee3d9) - the ONE place both
 * CREATE_PREVIEW and RENDER compute a full-composition frame range from a
 * composition's own real, freshly-verified durationSeconds/frameRate (see
 * verify-render-composition.ts's own doc comment) - `Math.round` rather
 * than `Math.floor`/`Math.ceil` because a real AE composition's own
 * duration is always frameCount/frameRate exactly, so multiplying back
 * lands on (or a hair below/above, from float rounding) the real integer
 * frame count; never a caller-supplied or guessed span.
 */
export function computeFullCompositionFrameRange(durationSeconds: number, frameRate: number): { startFrame: number; endFrame: number } {
  const totalFrames = Math.round(durationSeconds * frameRate);
  return { startFrame: 0, endFrame: Math.max(0, totalFrames - 1) };
}

export function buildAerenderArgs(params: AerenderArgsParams): string[] {
  return [
    "-project",
    params.projectPath,
    "-comp",
    params.compName,
    "-RStemplate",
    params.renderSettingsTemplateName,
    "-OMtemplate",
    params.outputModuleTemplateName,
    "-s",
    String(params.startFrame),
    "-e",
    String(params.endFrame),
    "-output",
    params.outputPath,
    "-close",
    "DO_NOT_SAVE_CHANGES",
    "-v",
    "ERRORS_AND_PROGRESS"
  ];
}
