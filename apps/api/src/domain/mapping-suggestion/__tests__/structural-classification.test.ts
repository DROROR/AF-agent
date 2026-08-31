import { describe, expect, it } from "vitest";
import { classifyStructuralPlaceholder, detectKeepUnchangedIntent, detectWorkMapConflict, resolveKeepOriginal } from "../structural-classification.js";
import type { MappingEvidenceBundle } from "../../mapping-evidence/types.js";

function bundle(overrides: Partial<MappingEvidenceBundle> = {}): MappingEvidenceBundle {
  return {
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
    brandInputs: null,
    ...overrides
  };
}

describe("classifyStructuralPlaceholder", () => {
  it.each(["Camera 1", "Camera.1", "Phone_mask.png", "Alpha Matte", "Shape Layer 1", "CONTROL", "alpha helper", "Phone.png", "Phone", "Scene Wrapper", "structural helper", "template control"])(
    "identifies %s as structural",
    (name) => {
      expect(classifyStructuralPlaceholder(bundle({ placeholderName: name })).isStructural).toBe(true);
    }
  );

  it.each(["Phone_screen", "Sc_03_screen", "Display", "Logo", "Body Text", "Hero Video", "Product Image", "Photo"])(
    "never classifies a real content target (%s) as structural, even though its name might otherwise look ambiguous",
    (name) => {
      expect(classifyStructuralPlaceholder(bundle({ placeholderName: name })).isStructural).toBe(false);
    }
  );

  it("never reclassifies a placeholder already classified as a real content type, regardless of its layer name", () => {
    const result = classifyStructuralPlaceholder(bundle({ placeholderName: "CONTROL", currentClassification: "image" }));
    expect(result.isStructural).toBe(false);
  });

  it("returns not-structural when there is no layer name to go on", () => {
    expect(classifyStructuralPlaceholder(bundle({ placeholderName: null })).isStructural).toBe(false);
  });

  it("does not match an ordinary content layer name that shares no structural pattern", () => {
    expect(classifyStructuralPlaceholder(bundle({ placeholderName: "Hero Image" })).isStructural).toBe(false);
  });
});

describe("detectKeepUnchangedIntent", () => {
  it("matches explicit Work Map instructions text", () => {
    const result = detectKeepUnchangedIntent(
      bundle({ workMapEntry: { id: "wm-1", sourceCompositionId: "comp-1", sourceReference: null, desiredAssetId: null, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: "Keep Phone.png unchanged." } })
    );
    expect(result.matched).toBe(true);
  });

  it("matches explicit scene instructions text", () => {
    expect(detectKeepUnchangedIntent(bundle({ userInstructions: "Structural phone frame comp; keep unchanged." })).matched).toBe(true);
  });

  it("does not match ordinary instructions with no keep-unchanged wording", () => {
    expect(detectKeepUnchangedIntent(bundle({ userInstructions: "Use the client's hero video here." })).matched).toBe(false);
  });

  it("does not match when there is no instructions text at all", () => {
    expect(detectKeepUnchangedIntent(bundle()).matched).toBe(false);
  });
});

describe("resolveKeepOriginal - the mapping-review deadlock fix", () => {
  it("resolves a structural layer with no Work Map opinion at all (manifest evidence alone is enough)", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: "Camera 1" })).shouldKeepOriginal).toBe(true);
  });

  it("resolves a mask helper with no Work Map opinion", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: "Phone_mask.png" })).shouldKeepOriginal).toBe(true);
  });

  it("resolves a phone frame artwork layer with no Work Map opinion", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: "Phone.png" })).shouldKeepOriginal).toBe(true);
  });

  it("resolves a shape layer with no Work Map opinion", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: "Shape Layer 1" })).shouldKeepOriginal).toBe(true);
  });

  it("resolves a CONTROL layer with no Work Map opinion", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: "CONTROL" })).shouldKeepOriginal).toBe(true);
  });

  it("resolves a scene wrapper explicitly named as unchanged", () => {
    const result = resolveKeepOriginal(bundle({ placeholderName: "Scene Wrapper", userInstructions: "Keep scene wrapper animation unchanged." }));
    expect(result.shouldKeepOriginal).toBe(true);
  });

  it("never resolves a real content target (Phone_screen) just because a SIBLING structural layer or the scene-level instructions say 'keep unchanged' (section D)", () => {
    const result = resolveKeepOriginal(bundle({ placeholderName: "Phone_screen", userInstructions: "Keep scene wrapper animation unchanged." }));
    expect(result.shouldKeepOriginal).toBe(false);
  });

  it("never resolves nested text just because the parent wrapper intent says keep unchanged", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: "Body Text", userInstructions: "Keep scene wrapper animation unchanged." })).shouldKeepOriginal).toBe(false);
  });

  it("never resolves nested logo just because the parent wrapper intent says keep unchanged", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: "Logo", userInstructions: "Keep scene wrapper animation unchanged." })).shouldKeepOriginal).toBe(false);
  });

  it("real production bug on test22: resolves a composition-level bundle (no specific placeholder detected) when the Work Map/scene instructions explicitly say to keep it unchanged - e.g. 'structural scene wrapper'/'structural phone frame comp' Work Map entries stuck as Needs Review forever", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: null, mappingId: null, userInstructions: "Keep unchanged." })).shouldKeepOriginal).toBe(true);
  });

  it("never resolves a composition-level bundle with no explicit keep-unchanged wording at all - genuinely nothing to go on", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: null, mappingId: null, userInstructions: null })).shouldKeepOriginal).toBe(false);
  });

  it("never resolves an ordinary content placeholder with no structural evidence and no explicit intent", () => {
    expect(resolveKeepOriginal(bundle({ placeholderName: "Hero Image" })).shouldKeepOriginal).toBe(false);
  });

  it("real production bug on test22, exact shape: the 'keep unchanged' wording comes from the Work Map ENTRY's own instructions field, not the scene's separate userInstructions - both are honored", () => {
    const result = resolveKeepOriginal(
      bundle({
        placeholderName: null,
        mappingId: null,
        userInstructions: null,
        workMapEntry: {
          id: "wm-1",
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: null,
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: "Work Map explicitly states this is a structural scene wrapper to keep unchanged. No evidence supports content assignment."
        }
      })
    );
    expect(result.shouldKeepOriginal).toBe(true);
  });

  it("real production bug on test22, exact shape: 'structural phone frame comp to keep unchanged' Work Map wording also resolves the composition-level target", () => {
    const result = resolveKeepOriginal(
      bundle({
        placeholderName: null,
        mappingId: null,
        workMapEntry: {
          id: "wm-1",
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: null,
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: "Work Map explicitly states this is a structural phone frame comp to keep unchanged, with no content assignment needed."
        }
      })
    );
    expect(result.shouldKeepOriginal).toBe(true);
  });

  it("real production bug on test22, exact shape: a SIBLING nested content placeholder (e.g. 'Text 02') in the SAME scene, sharing the exact same 'keep unchanged' Work Map entry, is never swallowed - it is its own bundle with its own real name and no explicit text of its own", () => {
    const sharedWorkMapEntry = {
      id: "wm-1",
      sourceCompositionId: "comp-1",
      sourceReference: null,
      desiredAssetId: null,
      desiredText: null,
      assetTimestampSeconds: null,
      desiredDurationSeconds: null,
      instructions: "Work Map explicitly states this is a structural scene wrapper to keep unchanged."
    };
    // The composition-level bundle itself resolves...
    const compositionLevel = resolveKeepOriginal(bundle({ placeholderName: null, mappingId: null, workMapEntry: sharedWorkMapEntry }));
    expect(compositionLevel.shouldKeepOriginal).toBe(true);
    // ...but a real nested text placeholder in the SAME scene, sharing the SAME Work Map entry, does not.
    const nestedText = resolveKeepOriginal(bundle({ placeholderName: "Text 02", mappingId: "mapping-text-02", workMapEntry: sharedWorkMapEntry }));
    expect(nestedText.shouldKeepOriginal).toBe(false);
  });

  it("Phone_screen.png (a real content target) stays reviewable even when its parent comp's Work Map entry says the comp is a structural phone frame to keep unchanged", () => {
    const result = resolveKeepOriginal(
      bundle({
        placeholderName: "Phone_screen.png",
        currentClassification: null,
        workMapEntry: {
          id: "wm-1",
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: null,
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: "Work Map explicitly states this is a structural phone frame comp to keep unchanged."
        }
      })
    );
    expect(result.shouldKeepOriginal).toBe(false);
  });
});

describe("classifyStructuralPlaceholder - Phone_Comp naming (client-handoff false-Needs-Review fix)", () => {
  it.each(["Phone_Comp 01", "Phone Comp 3", "PhoneComp_02"])("identifies %s as structural", (name) => {
    expect(classifyStructuralPlaceholder(bundle({ placeholderName: name })).isStructural).toBe(true);
  });
});

describe("detectWorkMapConflict - agreement is never a conflict, only real contradiction is", () => {
  const workMapEntry = { id: "wm-1", sourceCompositionId: "comp-1", sourceReference: null, desiredAssetId: null, desiredText: null, assetTimestampSeconds: null, desiredDurationSeconds: null, instructions: "Keep Phone.png unchanged." };

  it("is never a conflict when the Work Map is silent (no entry for this scene)", () => {
    expect(detectWorkMapConflict(bundle({ workMapEntry: null }), { suggestedAssetId: "asset-1", suggestedText: null })).toBe(false);
  });

  it("is never a conflict when the proposal agrees - no replacement proposed at all", () => {
    expect(detectWorkMapConflict(bundle({ workMapEntry }), { suggestedAssetId: null, suggestedText: null })).toBe(false);
  });

  it("IS a conflict when an explicit 'keep unchanged' instruction is contradicted by a concrete asset replacement", () => {
    expect(detectWorkMapConflict(bundle({ workMapEntry }), { suggestedAssetId: "test-png", suggestedText: null })).toBe(true);
  });

  it("is never a conflict when the proposal matches the Work Map's own explicit desiredAssetId", () => {
    const entry = { ...workMapEntry, desiredAssetId: "asset-42", instructions: null };
    expect(detectWorkMapConflict(bundle({ workMapEntry: entry }), { suggestedAssetId: "asset-42", suggestedText: null })).toBe(false);
  });

  it("IS a conflict when the proposal names a DIFFERENT asset than the Work Map's own explicit desiredAssetId", () => {
    const entry = { ...workMapEntry, desiredAssetId: "asset-42", instructions: null };
    expect(detectWorkMapConflict(bundle({ workMapEntry: entry }), { suggestedAssetId: "test-png", suggestedText: null })).toBe(true);
  });

  it("IS a conflict when the proposal's text differs from the Work Map's own explicit desiredText", () => {
    const entry = { ...workMapEntry, desiredText: "Hello world", instructions: null };
    expect(detectWorkMapConflict(bundle({ workMapEntry: entry }), { suggestedAssetId: null, suggestedText: "Something else" })).toBe(true);
  });

  it("is never a conflict when the proposal's text matches the Work Map's own explicit desiredText", () => {
    const entry = { ...workMapEntry, desiredText: "Hello world", instructions: null };
    expect(detectWorkMapConflict(bundle({ workMapEntry: entry }), { suggestedAssetId: null, suggestedText: "Hello world" })).toBe(false);
  });
});
