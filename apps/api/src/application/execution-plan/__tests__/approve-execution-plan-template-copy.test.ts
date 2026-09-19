import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, computeTextVerification, type Placeholder, type TemplateManifest } from "@dyo/schemas";
import { PreconditionNotMetError } from "../../../errors/app-error.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../test-support/in-memory-execution-plan-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { createProject } from "../../project/create-project.js";
import { createExecutionPlan } from "../create-execution-plan.js";
import { updateExecutionPlan } from "../update-execution-plan.js";
import { approveExecutionPlan } from "../approve-execution-plan.js";
import type { BrandRulesConfig } from "../../../domain/brand-rules/validate-brand-rules.js";

const NOW = new Date("2026-09-18T00:00:00.000Z");
const fixedNow = () => NOW;
const USER_ID = "11111111-1111-1111-1111-111111111111";

/** Brand rules are a separate gate with its own tests - switched off here so these tests exercise the template-copy gate alone. */
const NO_BRAND_RULES: BrandRulesConfig = {
  requireLogoPresence: false,
  requiredHebrewText: "",
  dyoBlueHex: null,
  rtlPreservedByConstruction: true
};

interface LayerSpec {
  placeholderId: string;
  layerName: string;
  /** Omitted entirely for a LEGACY manifest that never captured the template's own text. */
  originalText?: string;
  /** A text too long to store in full: the manifest keeps a display-only excerpt plus digests of the COMPLETE text, which is what this carries. */
  longText?: string;
}

/** Two synthetic scenes, so duplicate wording across scenes can be exercised end-to-end. */
function manifest(sceneALayers: readonly LayerSpec[], sceneBLayers: readonly LayerSpec[] = []): TemplateManifest {
  const placeholder = (compositionId: string, spec: LayerSpec, index: number): Placeholder => ({
    placeholderId: spec.placeholderId,
    displayLabel: null,
    compositionId,
    layerName: spec.layerName,
    layerIndex: index + 1,
    layerPath: [],
    placeholderType: "text",
    editable: true,
    sourceType: "TextLayer",
    ...(spec.originalText === undefined ? {} : { originalText: spec.originalText }),
    ...(spec.longText === undefined
      ? {}
      : {
          originalTextTruncated: true,
          originalTextPreview: spec.longText.slice(0, 10_000),
          originalTextVerification: { ...computeTextVerification(spec.longText), sourceProjectSha256: "a".repeat(64) }
        }),
    dimensions: null,
    startTimeSeconds: 0,
    durationSeconds: 5,
    evidence: { source: "read_directly", reason: "AE layer type is TextLayer" }
  });
  const composition = (compositionId: string, name: string, index: number) => ({
    compositionId,
    aeProjectItemIndex: index,
    name,
    widthPx: 1920,
    heightPx: 1080,
    durationSeconds: 5,
    frameRate: 30,
    isNestedOnlyReferenced: false,
    parentCompositionIds: []
  });
  const scenes = [
    {
      sceneId: "scene-a",
      displayName: null,
      compositionId: "comp-a",
      originalOrderIndex: 0,
      startTimeSeconds: 0,
      durationSeconds: 5,
      placeholders: sceneALayers.map((spec, index) => placeholder("comp-a", spec, index))
    }
  ];
  if (sceneBLayers.length > 0) {
    scenes.push({
      sceneId: "scene-b",
      displayName: null,
      compositionId: "comp-b",
      originalOrderIndex: 1,
      startTimeSeconds: 5,
      durationSeconds: 5,
      placeholders: sceneBLayers.map((spec, index) => placeholder("comp-b", spec, index))
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-under-test",
    templateName: "Template Under Test",
    sourceProject: { path: "/copies/under-test.aep", name: "under-test.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW.toISOString(),
    compositions: sceneBLayers.length > 0 ? [composition("comp-a", "Scene A", 1), composition("comp-b", "Scene B", 2)] : [composition("comp-a", "Scene A", 1)],
    scenes,
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

async function setup(manifestValue: TemplateManifest) {
  const projectRepository = new InMemoryProjectRepository();
  const executionPlanRepository = new InMemoryExecutionPlanRepository();
  const assetRepository = new InMemoryAssetRepository();
  const project = await createProject({ projectRepository, now: fixedNow }, { name: "Test Project", manifest: manifestValue });
  const plan = await createExecutionPlan({ projectRepository, executionPlanRepository, now: fixedNow }, project.projectId);
  const scenes = plan.plan.scenePlans.map((scene) => ({
    sceneId: scene.id,
    mappingIds: scene.mappings.map((mapping) => mapping.id),
    mappingByPlaceholder: new Map(scene.mappings.map((mapping) => [mapping.manifestPlaceholderId, mapping.id]))
  }));
  const edit = (operations: Parameters<typeof updateExecutionPlan>[2]["operations"], baseRevision: number, editedBy: string | undefined = USER_ID) =>
    updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, { baseRevision, operations }, editedBy);
  const approve = (baseRevision: number) =>
    approveExecutionPlan({ executionPlanRepository, projectRepository, now: fixedNow, brandRulesConfig: NO_BRAND_RULES }, project.projectId, USER_ID, {
      baseRevision
    });
  return { projectRepository, executionPlanRepository, assetRepository, project, scenes, edit, approve };
}

describe("approveExecutionPlan - leftover template copy (real backend gate)", () => {
  it("refuses approval while a mapping's text is still the template's own wording", async () => {
    const { scenes, edit, approve, executionPlanRepository, project } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "Headline", originalText: "Assets" }])
    );
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: "Assets" }], 1);

    const attempt = approve(2);
    await expect(attempt).rejects.toThrow(PreconditionNotMetError);
    await expect(attempt).rejects.toThrow(/unreviewed template copy/i);
    await expect(attempt).rejects.toThrow(/Headline/);

    expect((await executionPlanRepository.findCurrentByProjectId(project.projectId))?.status).toBe("DRAFT");
  });

  it("refuses approval for a case-only variant, and for a whitespace-only variant", async () => {
    for (const text of ["ASSETS", "  Assets  "]) {
      const { scenes, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "Headline", originalText: "Assets" }]));
      const scene = scenes[0]!;
      await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text }], 1);
      await expect(approve(2)).rejects.toThrow(/unreviewed template copy/i);
    }
  });

  it("approves once the text is genuinely replaced", async () => {
    const { scenes, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "Headline", originalText: "Assets" }]));
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: "Your own words" }], 1);
    const approved = await approve(2);
    expect(approved.plan.status).toBe("APPROVED");
  });

  it("approves identical text only after an explicit KEEP_TEMPLATE_TEXT decision - silence is never approval", async () => {
    const { scenes, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "Headline", originalText: "Assets" }]));
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: "Assets" }], 1);
    await expect(approve(2)).rejects.toThrow(/unreviewed template copy/i);

    await edit([{ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, decision: "KEEP_TEMPLATE_TEXT" }], 2);
    const approved = await approve(3);
    expect(approved.plan.status).toBe("APPROVED");

    const decided = approved.plan.scenePlans[0]?.mappings[0]?.keepTemplateText;
    expect(decided).toMatchObject({ decision: "KEEP_TEMPLATE_TEXT", decidedBy: USER_ID, textAtDecision: "Assets" });
    expect(decided?.decidedAt).toBe(NOW.toISOString());
  });

  it("a decision made about earlier text does not survive a later edit", async () => {
    const { scenes, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "Headline", originalText: "Assets" }]));
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: "Assets" }], 1);
    await edit([{ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, decision: "KEEP_TEMPLATE_TEXT" }], 2);
    // The reviewer edits the text to a case-only variant afterwards: the old
    // decision described different text and must not carry over.
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: "ASSETS" }], 3);

    await expect(approve(4)).rejects.toThrow(/made about different text/);
  });

  it("CLEAR_TEMPLATE_TEXT_DECISION puts the mapping back to needing a decision", async () => {
    const { scenes, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "Headline", originalText: "Assets" }]));
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: "Assets" }], 1);
    await edit([{ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, decision: "KEEP_TEMPLATE_TEXT" }], 2);
    await edit([{ type: "CLEAR_TEMPLATE_TEXT_DECISION", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]! }], 3);
    await expect(approve(4)).rejects.toThrow(/unreviewed template copy/i);
  });

  it("refuses to record a decision with no known user - an unattributable decision is not auditable", async () => {
    const { scenes, edit, executionPlanRepository, assetRepository, project } = await setup(
      manifest([{ placeholderId: "ph-1", layerName: "Headline", originalText: "Assets" }])
    );
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: "Assets" }], 1);

    // Called WITHOUT the editing user, exactly as an older caller would.
    await expect(
      updateExecutionPlan({ executionPlanRepository, assetRepository, now: fixedNow }, project.projectId, {
        baseRevision: 2,
        operations: [{ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, decision: "KEEP_TEMPLATE_TEXT" }]
      })
    ).rejects.toThrow(/deciding user's identity/);
  });

  it("requires a decision per scene when two scenes repeat the same template wording", async () => {
    const { scenes, edit, approve } = await setup(
      manifest([{ placeholderId: "ph-a", layerName: "Line", originalText: "Shared line" }], [{ placeholderId: "ph-b", layerName: "Line", originalText: "Shared line" }])
    );
    const [sceneA, sceneB] = scenes as [(typeof scenes)[number], (typeof scenes)[number]];
    await edit(
      [
        { type: "SET_TEXT", scenePlanId: sceneA.sceneId, mappingId: sceneA.mappingIds[0]!, text: "Shared line" },
        { type: "SET_TEXT", scenePlanId: sceneB.sceneId, mappingId: sceneB.mappingIds[0]!, text: "Shared line" }
      ],
      1
    );
    // Deciding only the first occurrence must NOT clear the second.
    await edit([{ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: sceneA.sceneId, mappingId: sceneA.mappingIds[0]!, decision: "KEEP_TEMPLATE_TEXT" }], 2);
    await expect(approve(3)).rejects.toThrow(/unreviewed template copy/i);

    await edit([{ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: sceneB.sceneId, mappingId: sceneB.mappingIds[0]!, decision: "KEEP_TEMPLATE_TEXT" }], 3);
    expect((await approve(4)).plan.status).toBe("APPROVED");
  });

  it("refuses approval for a template text too long to store, then approves after an explicit keep - never an impossible re-inspection", async () => {
    const longTemplateText = `${"a".repeat(10_000)} and the template's own real ending`;
    const { scenes, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "Long Line", longText: longTemplateText }]));
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: longTemplateText }], 1);

    const attempt = approve(2);
    await expect(attempt).rejects.toThrow(/unreviewed template copy/i);
    await expect(attempt).rejects.not.toThrow(/re-run template inspection/);

    await edit([{ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, decision: "KEEP_TEMPLATE_TEXT" }], 2);
    expect((await approve(3)).plan.status).toBe("APPROVED");
  });

  it("approves a long text replaced only after character 10,000 - the difference is beyond any stored excerpt", async () => {
    const shared = "a".repeat(10_000);
    const { scenes, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "Long Line", longText: `${shared} template ending` }]));
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: `${shared} the client's own ending` }], 1);
    expect((await approve(2)).plan.status).toBe("APPROVED");
  });

  it("refuses approval against a LEGACY manifest that never captured template text, whatever the reviewer decides", async () => {
    const { scenes, edit, approve } = await setup(manifest([{ placeholderId: "ph-1", layerName: "Headline" }]));
    const scene = scenes[0]!;
    await edit([{ type: "SET_TEXT", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, text: "Completely new wording" }], 1);
    await expect(approve(2)).rejects.toThrow(/re-run template inspection/);

    await edit([{ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: scene.sceneId, mappingId: scene.mappingIds[0]!, decision: "KEEP_TEMPLATE_TEXT" }], 2);
    await expect(approve(3)).rejects.toThrow(/re-run template inspection/);
  });
});
