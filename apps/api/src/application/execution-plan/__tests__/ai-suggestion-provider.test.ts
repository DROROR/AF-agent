import { describe, expect, it } from "vitest";
import { NotConfiguredAiSuggestionProvider, SuggestionsNotConfiguredError } from "../ai-suggestion-provider.js";

/**
 * No real AI provider exists yet (Phase 4 section 11: "Do not integrate a
 * production AI provider yet"). This only proves the honest-stub contract
 * - it never calls any real AI/network service, matching "Do not call
 * OpenAI/Claude during tests".
 */
describe("NotConfiguredAiSuggestionProvider", () => {
  it("fails loudly with a typed error rather than fabricating a suggestion", async () => {
    const provider = new NotConfiguredAiSuggestionProvider();
    await expect(
      provider.suggest({
        schemaVersion: "1.0",
        templateId: "tmpl-1",
        templateName: "tmpl-1",
        sourceProject: { path: "/x.aep", name: "x.aep", sha256: "a".repeat(64) },
        afterEffects: { version: null },
        generatedAt: "2026-08-26T00:00:00.000Z",
        compositions: [],
        scenes: [],
        preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
        unknownItems: []
      })
    ).rejects.toThrow(SuggestionsNotConfiguredError);
  });
});
