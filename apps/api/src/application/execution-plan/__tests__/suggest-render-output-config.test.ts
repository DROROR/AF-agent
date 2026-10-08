import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type TemplateManifest } from "@dyo/schemas";
import { ProjectNotFoundError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { setRenderOutputConfig } from "../set-render-output-config.js";
import { suggestRenderOutputConfig } from "../suggest-render-output-config.js";

const WORKER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type ManifestComposition = TemplateManifest["compositions"][number];

function composition(compositionId: string, name: string, overrides: Partial<ManifestComposition> = {}): ManifestComposition {
  return {
    compositionId,
    aeProjectItemIndex: 1,
    name,
    widthPx: 1920,
    heightPx: 1080,
    durationSeconds: 5,
    frameRate: 30,
    isNestedOnlyReferenced: false,
    parentCompositionIds: [],
    ...overrides
  };
}

/** Made-up neutral manifests - one master plus a nested helper by default. */
function manifest(compositions: ManifestComposition[]): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "/copies/test.aep", name: "test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.0" },
    generatedAt: new Date("2026-10-04T00:00:00.000Z").toISOString(),
    compositions,
    scenes: [
      { sceneId: "scene-a", displayName: null, compositionId: compositions[0]!.compositionId, originalOrderIndex: 0, startTimeSeconds: 0, durationSeconds: 5, placeholders: [] }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

const ONE_MASTER = (): TemplateManifest =>
  manifest([
    composition("comp-whole", "Whole Video"),
    composition("comp-part", "A Part", { aeProjectItemIndex: 2, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-whole"] })
  ]);
const TWO_MASTERS = (): TemplateManifest => manifest([composition("comp-whole", "Whole Video"), composition("comp-other", "Other Video", { aeProjectItemIndex: 2 })]);

function harness() {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  let tick = 0;
  // Each call is one second later than the last, so "most recently updated"
  // is decided by the order things were created in, never by a tie.
  const now = (): Date => new Date(Date.UTC(2026, 9, 4, 0, 0, tick++));

  async function addProject(name: string, sourceWorkerId: string | null, projectManifest: TemplateManifest = ONE_MASTER()): Promise<string> {
    const project = await createProject({ projectRepository, now }, { name, manifest: projectManifest, ...(sourceWorkerId ? { sourceWorkerId } : {}) });
    await createExecutionPlan({ projectRepository, executionPlanRepository, now }, project.projectId);
    return project.projectId;
  }

  async function configure(projectId: string, renderSettingsTemplateName: string, outputModuleTemplateName: string): Promise<void> {
    await setRenderOutputConfig({ executionPlanRepository, projectRepository, now }, projectId, "LANDSCAPE", {
      manifestCompositionId: "comp-whole",
      renderSettingsTemplateName,
      outputModuleTemplateName
    });
  }

  const suggest = (projectId: string) => suggestRenderOutputConfig({ executionPlanRepository, projectRepository }, projectId, "LANDSCAPE");

  return { addProject, configure, suggest };
}

/**
 * 2026-10-04: a non-technical client was sent to an Advanced screen to type
 * two After Effects template names. The suggestion exists so they are not -
 * and it is only worth having if it never guesses, which is what every case
 * below pins.
 */
describe("suggestRenderOutputConfig", () => {
  it("offers the one master composition and the names another project on the same worker is set up with", async () => {
    const { addProject, configure, suggest } = harness();
    const sibling = await addProject("Earlier Project", WORKER_A);
    await configure(sibling, "Settings One", "Module One");
    const projectId = await addProject("New Project", WORKER_A);

    expect(await suggest(projectId)).toEqual({
      suggestion: {
        manifestCompositionId: "comp-whole",
        compositionName: "Whole Video",
        renderSettingsTemplateName: "Settings One",
        outputModuleTemplateName: "Module One",
        basedOnProjectName: "Earlier Project"
      }
    });
  });

  it("offers nothing when the template has two master compositions - that is a choice, and the choice is the person's", async () => {
    const { addProject, configure, suggest } = harness();
    const sibling = await addProject("Earlier Project", WORKER_A);
    await configure(sibling, "Settings One", "Module One");
    const projectId = await addProject("New Project", WORKER_A, TWO_MASTERS());

    expect(await suggest(projectId)).toEqual({ suggestion: null });
  });

  // REAL 2026-10-08: the client's first project on his machine had nothing to
  // copy from, was shown the form, and typed a template name After Effects
  // does not have. With no sibling's names, After Effects' own built-in
  // templates are offered, said to be built-in (basedOnProjectName null).
  it("offers After Effects' built-in templates when no other project on the worker has this output set up", async () => {
    const { addProject, suggest } = harness();
    await addProject("Earlier Project", WORKER_A);
    const projectId = await addProject("New Project", WORKER_A);

    expect(await suggest(projectId)).toEqual({
      suggestion: {
        manifestCompositionId: "comp-whole",
        compositionName: "Whole Video",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
        basedOnProjectName: null
      }
    });
  });

  it("offers the built-in templates, never a sibling's names, when the project has no recorded source worker - a sibling's names cannot be known to exist on an unknown machine", async () => {
    const { addProject, configure, suggest } = harness();
    const sibling = await addProject("Earlier Project", null);
    await configure(sibling, "Settings One", "Module One");
    const projectId = await addProject("New Project", null);

    expect(await suggest(projectId)).toEqual({
      suggestion: {
        manifestCompositionId: "comp-whole",
        compositionName: "Whole Video",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
        basedOnProjectName: null
      }
    });
  });

  it("never takes names from a project inspected on a DIFFERENT worker - the built-in templates are offered instead", async () => {
    const { addProject, configure, suggest } = harness();
    const elsewhere = await addProject("Other Machine Project", WORKER_B);
    await configure(elsewhere, "Settings One", "Module One");
    const projectId = await addProject("New Project", WORKER_A);

    expect(await suggest(projectId)).toEqual({
      suggestion: {
        manifestCompositionId: "comp-whole",
        compositionName: "Whole Video",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
        basedOnProjectName: null
      }
    });
  });

  it("never suggests from the project itself, even when it is the only one configured - the built-in templates are offered instead", async () => {
    const { addProject, configure, suggest } = harness();
    const projectId = await addProject("Only Project", WORKER_A);
    await configure(projectId, "Settings One", "Module One");

    expect(await suggest(projectId)).toEqual({
      suggestion: {
        manifestCompositionId: "comp-whole",
        compositionName: "Whole Video",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Render Settings - 15 Mbps",
        basedOnProjectName: null
      }
    });
  });

  it("takes the most recently updated sibling that has the output set up, skipping newer ones that do not", async () => {
    const { addProject, configure, suggest } = harness();
    const older = await addProject("Older Project", WORKER_A);
    await configure(older, "Settings Old", "Module Old");
    const newer = await addProject("Newer Project", WORKER_A);
    await configure(newer, "Settings New", "Module New");
    await addProject("Newest Unconfigured Project", WORKER_A);
    const projectId = await addProject("New Project", WORKER_A);

    const result = await suggest(projectId);
    expect(result.suggestion?.basedOnProjectName).toBe("Newer Project");
    expect(result.suggestion?.renderSettingsTemplateName).toBe("Settings New");
  });

  it("writes nothing: the project is still unconfigured after a suggestion is read", async () => {
    const { addProject, configure, suggest } = harness();
    const sibling = await addProject("Earlier Project", WORKER_A);
    await configure(sibling, "Settings One", "Module One");
    const projectId = await addProject("New Project", WORKER_A);

    await suggest(projectId);
    // Reading it twice gives the same answer, which it could not if the first read had configured this project.
    expect((await suggest(projectId)).suggestion?.basedOnProjectName).toBe("Earlier Project");
  });

  it("refuses an unknown project", async () => {
    const { suggest } = harness();
    await expect(suggest("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).rejects.toThrow(ProjectNotFoundError);
  });
});
