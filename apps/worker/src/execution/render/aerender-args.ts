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
 *   -v ERRORS_AND_WARNINGS      fixed, moderate log verbosity - never ALL
 *                              (unbounded chatter) and never SILENT (no
 *                              troubleshooting signal)
 */
export interface AerenderArgsParams {
  projectPath: string;
  compName: string;
  renderSettingsTemplateName: string;
  outputModuleTemplateName: string;
  outputPath: string;
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
    "-output",
    params.outputPath,
    "-close",
    "DO_NOT_SAVE_CHANGES",
    "-v",
    "ERRORS_AND_WARNINGS"
  ];
}
