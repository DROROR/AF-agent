import { describe, expect, it } from "vitest";
import { NotConfiguredAiSuggestionProvider, SuggestionsNotConfiguredError } from "../ai-suggestion-provider.js";

/**
 * No real AI provider exists yet (this phase never integrates a
 * production AI provider). This only proves the honest-stub contract -
 * it never calls any real AI/network service, matching "Do not call
 * OpenAI/Claude during tests".
 */
describe("NotConfiguredAiSuggestionProvider", () => {
  it("fails loudly with a typed error rather than fabricating a suggestion", async () => {
    const provider = new NotConfiguredAiSuggestionProvider();
    await expect(
      provider.suggest([
        {
          scenePlanId: "scene-1",
          manifestCompositionId: "comp-1",
          compositionName: "Scene 01",
          sourcePosition: 0,
          mappingId: "mapping-1",
          manifestPlaceholderId: "ph-1",
          placeholderName: "Hero Image",
          currentClassification: null,
          sceneEvidence: null,
          workMapEntry: null,
          candidateAssets: [],
          userInstructions: null,
          brandInputs: null
        }
      ])
    ).rejects.toThrow(SuggestionsNotConfiguredError);
  });
});
