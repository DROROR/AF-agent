import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, templateManifestSchema, type TemplateManifest } from "../template-manifest.js";
import { inspectTemplateRequestSchema, inspectTemplateResponseSchema } from "../inspect-template.js";

function validManifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "Cognitica",
    sourceProject: { path: "/copies/Cognitica-copy.aep", name: "Cognitica.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: new Date().toISOString(),
    compositions: [
      {
        compositionId: "comp-1",
        name: "Main Comp",
        widthPx: 1920,
        heightPx: 1080,
        durationSeconds: 30,
        frameRate: 30,
        isNestedOnlyReferenced: false,
        parentCompositionIds: []
      }
    ],
    scenes: [
      {
        sceneId: "scene-1",
        displayName: null,
        compositionId: "comp-1",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: [
          {
            placeholderId: "ph-1",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Headline",
            layerIndex: 1,
            layerPath: [],
            placeholderType: "text",
            editable: true,
            sourceType: "TextLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "AE layer type is TextLayer" }
          }
        ]
      }
    ],
    preflight: {
      requiredFonts: ["Heebo"],
      footageReferenced: ["logo.png"],
      missingFootage: [],
      pluginReferences: []
    },
    unknownItems: []
  };
}

describe("templateManifestSchema", () => {
  it("accepts a fully-populated valid manifest", () => {
    expect(() => templateManifestSchema.parse(validManifest())).not.toThrow();
  });

  it("rejects a manifest with the wrong schemaVersion", () => {
    const manifest = { ...validManifest(), schemaVersion: "2.0" };
    expect(() => templateManifestSchema.parse(manifest)).toThrow();
  });

  it("rejects a placeholder type outside the fixed enum", () => {
    const manifest = validManifest();
    manifest.scenes[0]!.placeholders[0]!.placeholderType = "left_phone" as never;
    expect(() => templateManifestSchema.parse(manifest)).toThrow();
  });

  it("rejects an evidence source outside read_directly/inferred/unknown", () => {
    const manifest = validManifest();
    manifest.scenes[0]!.placeholders[0]!.evidence.source = "guessed" as never;
    expect(() => templateManifestSchema.parse(manifest)).toThrow();
  });

  it("allows displayName/displayLabel to be null - never required to be filled in by automated inspection", () => {
    const manifest = validManifest();
    expect(manifest.scenes[0]!.displayName).toBeNull();
    expect(manifest.scenes[0]!.placeholders[0]!.displayLabel).toBeNull();
    expect(() => templateManifestSchema.parse(manifest)).not.toThrow();
  });

  it("rejects a negative layerIndex", () => {
    const manifest = validManifest();
    manifest.scenes[0]!.placeholders[0]!.layerIndex = -1;
    expect(() => templateManifestSchema.parse(manifest)).toThrow();
  });

  it("accepts an unknownItems entry with context and reason", () => {
    const manifest = validManifest();
    manifest.unknownItems.push({ context: "Comp X / Layer Y", reason: "unrecognized layer kind" });
    expect(() => templateManifestSchema.parse(manifest)).not.toThrow();
  });
});

describe("inspectTemplateRequestSchema", () => {
  it("accepts a valid request", () => {
    const result = inspectTemplateRequestSchema.parse({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/Cognitica-copy.aep"
    });
    expect(result.templateId).toBe("tmpl-1");
  });

  it("rejects a blank sourceProjectPath", () => {
    expect(() =>
      inspectTemplateRequestSchema.parse({ templateId: "tmpl-1", sourceProjectPath: "" })
    ).toThrow();
  });
});

describe("inspectTemplateResponseSchema", () => {
  it("accepts a manifest paired with a matching summary", () => {
    const response = {
      manifest: validManifest(),
      summary: {
        compositionCount: 1,
        candidateSceneCount: 1,
        editablePlaceholderCount: 1,
        nestedCompositionCount: 0,
        requiredFontCount: 1,
        footageReferencedCount: 1,
        missingFootageCount: 0,
        pluginReferenceCount: 0,
        unknownItemCount: 0
      }
    };
    expect(() => inspectTemplateResponseSchema.parse(response)).not.toThrow();
  });
});
