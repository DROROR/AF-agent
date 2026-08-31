import { describe, expect, it } from "vitest";
import type { MappingSuggestion } from "@dyo/schemas";
import { isSafeToBulkAccept } from "./safe-bulk-accept";

function suggestion(overrides: Partial<MappingSuggestion> = {}): MappingSuggestion {
  return {
    id: "s1",
    projectId: "11111111-1111-1111-1111-111111111111",
    scenePlanId: "scene-1",
    mappingId: "mapping-1",
    source: "DETERMINISTIC",
    status: "PENDING",
    suggestedClassification: "video",
    suggestedAssetId: "asset-1",
    suggestedText: null,
    suggestedAssetTimestamp: null,
    suggestedFinalDuration: null,
    confidence: 1,
    reasoning: "The Work Map explicitly assigns this asset to this scene.",
    evidenceRefs: [{ kind: "USER_INTENT", summary: "x" }],
    unresolvedReason: null,
    requiresHumanReview: false,
    conflictsWithWorkMap: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("isSafeToBulkAccept", () => {
  it("is safe for a real Work-Map-backed deterministic match (confidence 1, requiresHumanReview false)", () => {
    expect(isSafeToBulkAccept(suggestion())).toBe(true);
  });

  it("is safe for a real text suggestion with no asset, as long as text is set", () => {
    expect(isSafeToBulkAccept(suggestion({ suggestedAssetId: null, suggestedText: "Discover the App" }))).toBe(true);
  });

  it("excludes anything not PENDING", () => {
    expect(isSafeToBulkAccept(suggestion({ status: "ACCEPTED" }))).toBe(false);
  });

  it("excludes a suggestion already marked Needs review (unresolvedReason set) - the low-confidence-guess safety gate already downgraded it", () => {
    expect(isSafeToBulkAccept(suggestion({ unresolvedReason: "Needs review - not enough evidence for a confident automatic suggestion", suggestedAssetId: null }))).toBe(false);
  });

  it("excludes anything requiresHumanReview - e.g. a heuristic filename match, confidence 0.75", () => {
    expect(isSafeToBulkAccept(suggestion({ requiresHumanReview: true, confidence: 0.75 }))).toBe(false);
  });

  it("excludes anything that conflicts with the Work Map", () => {
    expect(isSafeToBulkAccept(suggestion({ conflictsWithWorkMap: true }))).toBe(false);
  });

  it("excludes anything below the 0.75 High-confidence threshold, even without an explicit unresolvedReason", () => {
    expect(isSafeToBulkAccept(suggestion({ confidence: 0.6 }))).toBe(false);
  });

  it("includes exactly the 0.75 boundary value", () => {
    expect(isSafeToBulkAccept(suggestion({ confidence: 0.75 }))).toBe(true);
  });

  it("excludes a suggestion with neither a suggested asset nor text - nothing concrete to accept", () => {
    expect(isSafeToBulkAccept(suggestion({ suggestedAssetId: null, suggestedText: null }))).toBe(false);
  });
});
