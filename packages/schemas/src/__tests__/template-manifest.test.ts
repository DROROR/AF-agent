import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, templateManifestSchema, type TemplateManifest } from "../template-manifest.js";
import { hasAepExtension, inspectTemplateRequestSchema, inspectTemplateResponseSchema, inspectTemplateResultSchema } from "../inspect-template.js";

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
        aeProjectItemIndex: 1,
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

  it("rejects a directory-only path with no filename/extension at all (real production bug, 2026-08-30: C:\\DYO-Agent\\copy was accepted and produced a false SUCCEEDED job)", () => {
    expect(() =>
      inspectTemplateRequestSchema.parse({ templateId: "tmpl-1", sourceProjectPath: "C:\\DYO-Agent\\copy" })
    ).toThrow(/\.aep/);
  });

  it("rejects a real file path whose extension is not .aep", () => {
    expect(() =>
      inspectTemplateRequestSchema.parse({ templateId: "tmpl-1", sourceProjectPath: "C:\\DYO-Agent\\copy\\notes.txt" })
    ).toThrow(/\.aep/);
  });

  it("accepts the exact real full path that produced the valid manifest job (7e6db3a6)", () => {
    const result = inspectTemplateRequestSchema.parse({
      templateId: "White App Promo",
      sourceProjectPath: "C:\\DYO-Agent\\copy\\White App Promo.aep"
    });
    expect(result.sourceProjectPath).toBe("C:\\DYO-Agent\\copy\\White App Promo.aep");
  });

  it("accepts a case-insensitive .AEP extension", () => {
    expect(() =>
      inspectTemplateRequestSchema.parse({ templateId: "tmpl-1", sourceProjectPath: "C:\\copies\\template.AEP" })
    ).not.toThrow();
  });
});

describe("hasAepExtension", () => {
  it("accepts .aep in any case", () => {
    expect(hasAepExtension("C:\\a\\b.aep")).toBe(true);
    expect(hasAepExtension("C:\\a\\b.AEP")).toBe(true);
    expect(hasAepExtension("C:\\a\\b.AeP")).toBe(true);
  });

  it("rejects a directory path, an empty string, and a non-.aep extension", () => {
    expect(hasAepExtension("C:\\DYO-Agent\\copy")).toBe(false);
    expect(hasAepExtension("")).toBe(false);
    expect(hasAepExtension("C:\\a\\b.txt")).toBe(false);
  });
});

describe("inspectTemplateResponseSchema", () => {
  function validResponse() {
    return {
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
  }

  it("accepts a manifest paired with a matching summary", () => {
    expect(() => inspectTemplateResponseSchema.parse(validResponse())).not.toThrow();
  });

  describe("inspectTemplateResultSchema - the REAL persisted job.result shape", () => {
    it("accepts a kind:'manifest' envelope wrapping a valid response - the real shape a SUCCEEDED INSPECT_TEMPLATE job persists (job 7e6db3a6)", () => {
      const persisted = { kind: "manifest" as const, response: validResponse(), diagnostics: [] };
      const parsed = inspectTemplateResultSchema.parse(persisted);
      expect(parsed.kind).toBe("manifest");
      if (parsed.kind === "manifest") {
        expect(parsed.response.summary.compositionCount).toBe(1);
      }
    });

    it("accepts a kind:'raw_capture' envelope - the fallback shape a job-dispatcher.ts FAILED job persists for diagnostics", () => {
      const persisted = {
        kind: "raw_capture" as const,
        workerId: "11111111-1111-1111-1111-111111111111",
        jobId: "22222222-2222-2222-2222-222222222222",
        capturedAt: new Date().toISOString(),
        toolCalls: [{ tool: "ae_health", calledAt: new Date().toISOString(), ok: true }],
        note: "could not hash the real source .aep"
      };
      expect(() => inspectTemplateResultSchema.parse(persisted)).not.toThrow();
    });

    it("rejects the bare {manifest, summary} shape with no `kind` discriminator - the exact old wizard bug (parsing job.result directly against inspectTemplateResponseSchema instead of unwrapping .response first)", () => {
      expect(() => inspectTemplateResultSchema.parse(validResponse())).toThrow();
    });
  });
});
