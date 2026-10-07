// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScenePlanEntry, TemplateManifest } from "@dyo/schemas";
import { WholeVideoColours, collectColourGroups } from "./WholeVideoColours";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { manifestFixture, placeholderFixture, sceneFixture } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
});

const COLOUR = { value: "color", source: "MANIFEST", evidence: ["a uniform solid"] };

function colourMapping(id: string, placeholderId: string, name: string, colorHex: string | null = null) {
  return {
    id,
    manifestPlaceholderId: placeholderId,
    placeholderName: name,
    placeholderClassification: COLOUR,
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/** Two scenes that each hold a "Heading" colour and a "Dots" colour; scene B also holds one nested colour with no Color Control. */
function fixture(headingB: string | null = null) {
  const scenes = [
    sceneFixture({ id: "scene-a", mappings: [colourMapping("m-a-heading", "ph-a-heading", "Heading"), colourMapping("m-a-dots", "ph-a-dots", "Dots")] }),
    sceneFixture({
      id: "scene-b",
      mappings: [colourMapping("m-b-heading", "ph-b-heading", "Heading", headingB), colourMapping("m-b-dots", "ph-b-dots", "Dots"), colourMapping("m-b-nested", "ph-b-nested", "Nested fill")]
    })
  ] as unknown as ScenePlanEntry[];
  const control = (hex: string) => ({ colorControl: { currentColorHex: hex } });
  const manifest = manifestFixture([
    placeholderFixture({ placeholderId: "ph-a-heading", layerName: "Heading", placeholderType: "color", originalText: undefined, ...control("#F3F2F3") }),
    placeholderFixture({ placeholderId: "ph-a-dots", layerName: "Dots", placeholderType: "color", originalText: undefined, ...control("#FF0048") }),
    placeholderFixture({ placeholderId: "ph-b-heading", layerName: "Heading", placeholderType: "color", originalText: undefined, ...control("#F3F2F3") }),
    placeholderFixture({ placeholderId: "ph-b-dots", layerName: "Dots", placeholderType: "color", originalText: undefined, ...control("#FF0048") }),
    placeholderFixture({ placeholderId: "ph-b-nested", layerName: "Nested fill", placeholderType: "color", originalText: undefined, layerPath: [{ compositionId: "c2", layerIndex: 3 }] })
  ]) as unknown as TemplateManifest;
  return { scenes, manifest };
}

describe("collectColourGroups", () => {
  it("lists each repeated colour layer once, with every place it appears in and the template's colour", () => {
    const { scenes, manifest } = fixture();
    expect(collectColourGroups(scenes, manifest)).toEqual([
      { name: "Heading", targets: [{ scenePlanId: "scene-a", mappingId: "m-a-heading" }, { scenePlanId: "scene-b", mappingId: "m-b-heading" }], templateColorHex: "#F3F2F3", chosenColorHex: "" },
      { name: "Dots", targets: [{ scenePlanId: "scene-a", mappingId: "m-a-dots" }, { scenePlanId: "scene-b", mappingId: "m-b-dots" }], templateColorHex: "#FF0048", chosenColorHex: "" }
    ]);
  });

  it("leaves out a nested colour with no Color Control - the same one a scene's own drawer refuses", () => {
    const { scenes, manifest } = fixture();
    expect(collectColourGroups(scenes, manifest).map((group) => group.name)).not.toContain("Nested fill");
  });

  it("reports places that hold different colours as differing, never as one of them", () => {
    const { scenes, manifest } = fixture("#112233");
    expect(collectColourGroups(scenes, manifest)[0]?.chosenColorHex).toBeNull();
  });
});

describe("WholeVideoColours", () => {
  it("writes one chosen colour to every place that layer appears in, and nothing to a colour left alone", async () => {
    const { scenes, manifest } = fixture();
    const applyEdit = vi.fn(async () => ({ ok: true }));
    renderWithLocale(<WholeVideoColours scenePlans={scenes} manifest={manifest} disabled={false} applyEdit={applyEdit} />);

    const apply = screen.getByRole("button", { name: "Apply to the whole video" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Heading/), { target: { value: "#0a66c2" } });
    fireEvent.click(apply);

    await waitFor(() => expect(applyEdit).toHaveBeenCalledTimes(1));
    expect(applyEdit).toHaveBeenCalledWith([
      { type: "SET_BRAND_COLOR", scenePlanId: "scene-a", mappingId: "m-a-heading", colorHex: "#0A66C2" },
      { type: "SET_BRAND_COLOR", scenePlanId: "scene-b", mappingId: "m-b-heading", colorHex: "#0A66C2" }
    ]);
    await screen.findByText("Saved in 2 places. Make the preview again to see it.");
  });

  it("goes back to the template's colour everywhere with CLEAR_BRAND_COLOR", async () => {
    const { scenes, manifest } = fixture("#112233");
    const applyEdit = vi.fn(async () => ({ ok: true }));
    renderWithLocale(<WholeVideoColours scenePlans={scenes} manifest={manifest} disabled={false} applyEdit={applyEdit} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Reset" })[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Apply to the whole video" }));
    await waitFor(() => expect(applyEdit).toHaveBeenCalledTimes(1));
    expect(applyEdit).toHaveBeenCalledWith([
      { type: "CLEAR_BRAND_COLOR", scenePlanId: "scene-a", mappingId: "m-a-heading" },
      { type: "CLEAR_BRAND_COLOR", scenePlanId: "scene-b", mappingId: "m-b-heading" }
    ]);
  });

  it("shows the server's reason and keeps the choice when the save is refused", async () => {
    const { scenes, manifest } = fixture();
    const applyEdit = vi.fn(async () => ({ ok: false, message: "The plan changed - reload and try again" }));
    renderWithLocale(<WholeVideoColours scenePlans={scenes} manifest={manifest} disabled={false} applyEdit={applyEdit} />);
    fireEvent.change(screen.getByLabelText(/^Dots/), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to the whole video" }));
    await screen.findByText("The plan changed - reload and try again");
    expect((screen.getByRole("button", { name: "Apply to the whole video" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("is not drawn at all when no colour repeats - one place is what the scene's own card is for", () => {
    const { manifest } = fixture();
    const single = [sceneFixture({ id: "scene-a", mappings: [colourMapping("m-a-heading", "ph-a-heading", "Heading")] })] as unknown as ScenePlanEntry[];
    const { container } = renderWithLocale(<WholeVideoColours scenePlans={single} manifest={manifest} disabled={false} applyEdit={vi.fn()} />);
    expect(container.querySelector(".whole-video-colours")).toBeNull();
  });
});
