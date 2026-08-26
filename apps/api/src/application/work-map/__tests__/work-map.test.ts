import { describe, expect, it } from "vitest";
import { StaleWorkMapRevisionError } from "../../../errors/app-error.js";
import { InMemoryWorkMapRepository } from "../test-support/in-memory-work-map-repository.js";
import { getWorkMap } from "../get-work-map.js";
import { updateWorkMap } from "../update-work-map.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const fixedNow = () => NOW;
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function setup() {
  return { workMapRepository: new InMemoryWorkMapRepository() };
}

describe("getWorkMap", () => {
  it("returns null (never a 404) when no work map has been saved yet - a real, valid state", async () => {
    const { workMapRepository } = setup();
    const result = await getWorkMap({ workMapRepository }, PROJECT_ID);
    expect(result).toBeNull();
  });
});

describe("updateWorkMap", () => {
  it("creates revision 1 when baseRevision is 0 (no work map exists yet)", async () => {
    const { workMapRepository } = setup();
    const result = await updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, {
      baseRevision: 0,
      entries: [
        {
          sourceCompositionId: "comp-1",
          sourceReference: "Scene 1",
          desiredAssetId: null,
          desiredText: "Hello world",
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });
    expect(result.revision).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.id).toBeTruthy();
  });

  it("preserves null/unknown fields exactly - never silently fills in a guessed value", async () => {
    const { workMapRepository } = setup();
    const result = await updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, {
      baseRevision: 0,
      entries: [
        {
          sourceCompositionId: null,
          sourceReference: null,
          desiredAssetId: null,
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });
    expect(result.entries[0]).toMatchObject({
      sourceCompositionId: null,
      sourceReference: null,
      desiredAssetId: null,
      desiredText: null,
      assetTimestampSeconds: null,
      desiredDurationSeconds: null,
      instructions: null
    });
  });

  it("keeps an existing entry id across a revision instead of generating a new one", async () => {
    const { workMapRepository } = setup();
    const first = await updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, {
      baseRevision: 0,
      entries: [
        {
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: null,
          desiredText: "v1",
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });
    const entryId = first.entries[0]?.id as string;

    const second = await updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, {
      baseRevision: 1,
      entries: [
        {
          id: entryId,
          sourceCompositionId: "comp-1",
          sourceReference: null,
          desiredAssetId: null,
          desiredText: "v2",
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });
    expect(second.revision).toBe(2);
    expect(second.entries[0]?.id).toBe(entryId);
    expect(second.entries[0]?.desiredText).toBe("v2");
  });

  it("rejects a stale baseRevision - never silently overwrites a newer revision", async () => {
    const { workMapRepository } = setup();
    await updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, { baseRevision: 0, entries: [] });

    await expect(updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, { baseRevision: 0, entries: [] })).rejects.toThrow(
      StaleWorkMapRevisionError
    );
  });

  it("does NOT validate desiredAssetId against a real catalog - a work-map entry is intent, not yet an instruction", async () => {
    const { workMapRepository } = setup();
    const result = await updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, {
      baseRevision: 0,
      entries: [
        {
          sourceCompositionId: null,
          sourceReference: null,
          desiredAssetId: "an-asset-id-that-does-not-exist-anywhere",
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: null
        }
      ]
    });
    expect(result.entries[0]?.desiredAssetId).toBe("an-asset-id-that-does-not-exist-anywhere");
  });

  it("GET reflects the latest saved revision", async () => {
    const { workMapRepository } = setup();
    await updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, { baseRevision: 0, entries: [] });
    await updateWorkMap({ workMapRepository, now: fixedNow }, PROJECT_ID, { baseRevision: 1, entries: [] });

    const result = await getWorkMap({ workMapRepository }, PROJECT_ID);
    expect(result?.revision).toBe(2);
  });
});
