// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetDto, BrandNeed, ScenePlanEntry } from "@dyo/schemas";
import { BrandNeeds } from "./BrandNeeds";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, assetFixture, sceneFixture } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
});

const REQUIRED_LINE = "the configured line";
const NEEDS: BrandNeed[] = [
  { rule: "LOGO_PRESENCE", message: "no logo", requiredText: null },
  { rule: "REQUIRED_HEBREW_TEXT", message: "no line", requiredText: REQUIRED_LINE }
];

function mapping(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    manifestPlaceholderId: `ph-${id}`,
    placeholderName: id,
    placeholderClassification: { value: "image", source: "MANIFEST", evidence: [] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function fixture() {
  const scenes = [
    sceneFixture({
      id: "scene-a",
      mappings: [
        mapping("m-background", { selectedAssetId: "asset-mark", selectedAssetType: "image" }),
        mapping("m-screen", { selectedAssetId: "asset-shot", selectedAssetType: "image" }),
        mapping("m-credit", { placeholderClassification: { value: "text", source: "MANIFEST", evidence: [] }, text: "Our name" }),
        mapping("m-empty", { placeholderClassification: { value: "text", source: "MANIFEST", evidence: [] } })
      ]
    }),
    sceneFixture({ id: "scene-b", mappings: [mapping("m-again", { selectedAssetId: "asset-mark", selectedAssetType: "image" })] })
  ] as unknown as ScenePlanEntry[];
  const assets = [
    assetFixture({ id: "asset-mark", mediaKind: "IMAGE", label: "Clean mark" }),
    assetFixture({ id: "asset-shot", mediaKind: "IMAGE", label: "A screen" }),
    assetFixture({ id: "asset-clip", mediaKind: "VIDEO", label: "A clip" }),
    assetFixture({ id: "asset-logo", mediaKind: "LOGO", label: "Uploaded logo" })
  ] as unknown as AssetDto[];
  return { scenes, assets };
}

describe("BrandNeeds - what every DYO video must carry, said before approval", () => {
  it("draws nothing when nothing is missing", () => {
    const { scenes, assets } = fixture();
    renderWithLocale(<BrandNeeds projectId={PROJECT_ID} needs={[]} scenePlans={scenes} assets={assets} disabled={false} applyEdit={vi.fn()} />);
    expect(screen.queryByText("Every DYO video needs these")).toBeNull();
  });

  it("offers the pictures already placed as the logo, and one press states it for every place that picture is in", async () => {
    const { scenes, assets } = fixture();
    const applyEdit = vi.fn().mockResolvedValue({ ok: true });
    renderWithLocale(<BrandNeeds projectId={PROJECT_ID} needs={NEEDS} scenePlans={scenes} assets={assets} disabled={false} applyEdit={applyEdit} />);
    // Only still pictures that are in the video: not the clip, and not the logo file nobody placed (it is named instead).
    expect(screen.getAllByText("This is my logo")).toHaveLength(2);
    expect(screen.getByText(/Uploaded logo/)).toBeTruthy();
    fireEvent.click(screen.getByText("Clean mark"));
    await waitFor(() => expect(applyEdit).toHaveBeenCalledTimes(1));
    expect(applyEdit).toHaveBeenCalledWith([
      { type: "MAP_ASSET", scenePlanId: "scene-a", mappingId: "m-background", selectedAssetId: "asset-mark", selectedAssetType: "logo" },
      { type: "MAP_ASSET", scenePlanId: "scene-b", mappingId: "m-again", selectedAssetId: "asset-mark", selectedAssetType: "logo" }
    ]);
  });

  it("adds the server's exact line to the text the client picks - and only offers texts that are written", async () => {
    const { scenes, assets } = fixture();
    const applyEdit = vi.fn().mockResolvedValue({ ok: true });
    renderWithLocale(<BrandNeeds projectId={PROJECT_ID} needs={NEEDS} scenePlans={scenes} assets={assets} disabled={false} applyEdit={applyEdit} />);
    expect(screen.getByText(REQUIRED_LINE)).toBeTruthy();
    const select = screen.getByRole("combobox", { name: "Choose the text to add it to" }) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["Choose the text to add it to", "Our name"]);
    const add = screen.getByRole("button", { name: "Add the line to this text" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "m-credit" } });
    fireEvent.click(add);
    await waitFor(() => expect(applyEdit).toHaveBeenCalledTimes(1));
    expect(applyEdit).toHaveBeenCalledWith([{ type: "SET_TEXT", scenePlanId: "scene-a", mappingId: "m-credit", text: `Our name ${REQUIRED_LINE}` }]);
  });
});
