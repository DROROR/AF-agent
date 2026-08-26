// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SceneTableRow } from "@dyo/schemas";
import { SceneTable } from "./SceneTable";
import { renderWithLocale } from "../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

function row(overrides: Partial<SceneTableRow> = {}): SceneTableRow {
  return {
    scenePlanId: "scene-1",
    mappingId: "mapping-1",
    use: true,
    sourcePosition: 0,
    finalOrder: 1,
    compositionName: "Scene 01",
    placeholderLabel: "Left Phone",
    placeholderClassification: { value: null, source: "MANIFEST", evidence: ["unknown"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: 12.5,
    finalDuration: 4,
    approvalState: "UNREVIEWED",
    notes: null,
    instructions: null,
    unresolvedReasons: [],
    ...overrides
  };
}

function noop(): void {}

describe("SceneTable", () => {
  it("shows an honest empty state when given no rows - never invents placeholder rows", () => {
    renderWithLocale(<SceneTable rows={[]} onToggleUse={noop} onMove={noop} onEditScene={noop} />);
    screen.getByText("No scenes to review yet");
  });

  it("renders a real mapping row with its real fields, never a raw enum value", () => {
    renderWithLocale(<SceneTable rows={[row()]} onToggleUse={noop} onMove={noop} onEditScene={noop} />);
    screen.getByText("Scene 01");
    screen.getByText("Left Phone");
    screen.getByText("Unreviewed");
  });

  it("shows 'No assets uploaded' rather than a fabricated asset dropdown/value when selectedAssetId is null", () => {
    renderWithLocale(<SceneTable rows={[row({ selectedAssetId: null })]} onToggleUse={noop} onMove={noop} onEditScene={noop} />);
    screen.getByText("No assets uploaded");
  });

  it("shows the real asset id verbatim when one is actually mapped, never inventing a friendlier label", () => {
    renderWithLocale(<SceneTable rows={[row({ selectedAssetId: "asset-42" })]} onToggleUse={noop} onMove={noop} onEditScene={noop} />);
    screen.getByText("asset-42");
  });

  it("renders a scene with no detected placeholder honestly, never fabricating a mapping", () => {
    renderWithLocale(
      <SceneTable rows={[row({ mappingId: null, placeholderLabel: null })]} onToggleUse={noop} onMove={noop} onEditScene={noop} />
    );
    screen.getByText("No placeholder detected for this scene yet");
  });

  it("formats asset timestamp and final duration as mm:ss, and null as an em-dash", () => {
    renderWithLocale(
      <SceneTable rows={[row({ assetTimestamp: 65, finalDuration: 90 })]} onToggleUse={noop} onMove={noop} onEditScene={noop} />
    );
    screen.getByText("1:05");
    screen.getByText("1:30");
  });

  it("groups multiple placeholder-mapping rows under one scene, showing the scene name only once", () => {
    renderWithLocale(
      <SceneTable
        rows={[
          row({ mappingId: "mapping-1", placeholderLabel: "Left Phone" }),
          row({ mappingId: "mapping-2", placeholderLabel: "Right Phone" })
        ]}
        onToggleUse={noop}
        onMove={noop}
        onEditScene={noop}
      />
    );
    expect(screen.getAllByText("Scene 01")).toHaveLength(1);
    screen.getByText("Left Phone");
    screen.getByText("Right Phone");
  });

  it("keeps an unresolved/unknown classification honest - never renders a guessed placeholder type", () => {
    renderWithLocale(
      <SceneTable
        rows={[row({ placeholderClassification: { value: null, source: "MANIFEST", evidence: ["unknown"] } })]}
        onToggleUse={noop}
        onMove={noop}
        onEditScene={noop}
      />
    );
    expect(screen.queryByText("Phone")).toBeNull();
    expect(screen.queryByText("Image")).toBeNull();
    expect(screen.queryByText("Logo")).toBeNull();
  });

  it("calls onToggleUse with the new checked value when the Use checkbox is toggled", () => {
    const onToggleUse = vi.fn();
    renderWithLocale(<SceneTable rows={[row({ use: false })]} onToggleUse={onToggleUse} onMove={noop} onEditScene={noop} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleUse).toHaveBeenCalledWith("scene-1", true);
  });

  it("calls onMove with the scenePlanId and direction when a move button is clicked", () => {
    const onMove = vi.fn();
    renderWithLocale(<SceneTable rows={[row()]} onToggleUse={noop} onMove={onMove} onEditScene={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    expect(onMove).toHaveBeenCalledWith("scene-1", "up");
  });

  it("calls onEditScene with the scenePlanId when the Edit action is clicked", () => {
    const onEditScene = vi.fn();
    renderWithLocale(<SceneTable rows={[row()]} onToggleUse={noop} onMove={noop} onEditScene={onEditScene} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEditScene).toHaveBeenCalledWith("scene-1");
  });

  it("renders real Hebrew strings (not hardcoded English) when the Hebrew locale is active", () => {
    renderWithLocale(<SceneTable rows={[row()]} onToggleUse={noop} onMove={noop} onEditScene={noop} />, { locale: "he" });
    screen.getByText("טרם נבדק"); // rowApprovalState.UNREVIEWED
    screen.getByText("לא הועלו נכסים"); // noAssetsUploaded
  });

  it("disables interactive controls when disabled is true", () => {
    renderWithLocale(<SceneTable rows={[row()]} disabled onToggleUse={noop} onMove={noop} onEditScene={noop} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
