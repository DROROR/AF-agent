// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetDto, WorkMapAiSummary, WorkMapEntry } from "@dyo/schemas";
import { AiPlanSummaryPanel, LayerPlanCard, PlanCard } from "./SimpleWorkMapPlanView";
import { assetFixture } from "../test-utils/execution-plan-fixtures";
import { renderWithLocale } from "../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
});

function entry(overrides: Partial<WorkMapEntry> = {}): WorkMapEntry {
  return {
    id: "wm-1",
    sourceCompositionId: "c1",
    sourceReference: null,
    desiredAssetId: null,
    desiredText: null,
    assetTimestampSeconds: null,
    desiredDurationSeconds: null,
    instructions: null,
    ...overrides
  };
}

const sceneNameByCompositionId = new Map([["c1", "!Render"]]);
const assetById = new Map();

/**
 * Final Simple Mode UX pass, section 4 - reuse existing preview capability
 * where it genuinely exists, never fabricate one. PlanCard's previewUrl
 * prop is the single point where a real scene frame would render if the
 * caller ever has one; today no production caller does (see the prop's
 * own doc comment for why - INSPECT_SCENE_EVIDENCE is keyed by
 * scenePlanId, which does not exist before an execution plan does).
 * These tests prove the CONTRACT works correctly either way, independent
 * of that still-missing wiring.
 */
describe("PlanCard - real scene thumbnail vs. honest unavailable state (never a fake placeholder)", () => {
  it("CASE E: renders the real scene still when a previewUrl is provided", () => {
    renderWithLocale(
      <PlanCard
        entry={entry()}
        index={0}
        total={1}
        sceneNameByCompositionId={sceneNameByCompositionId}
        assetById={assetById}
        previewUrl="/api/projects/proj-1/scene-evidence-preview/c1"
        onEditPlan={() => {}}
      />
    );

    const img = screen.getByRole("img", { name: "Main Scene" }) as HTMLImageElement;
    expect(img.src).toContain("/api/projects/proj-1/scene-evidence-preview/c1");
    expect(screen.queryByText("Scene preview not generated yet")).toBeNull();
  });

  it("CASE F: shows the honest 'not generated yet' state - never a fake/decorative image - when no previewUrl exists", () => {
    renderWithLocale(
      <PlanCard
        entry={entry()}
        index={0}
        total={1}
        sceneNameByCompositionId={sceneNameByCompositionId}
        assetById={assetById}
        previewUrl={null}
        onEditPlan={() => {}}
      />
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Scene preview not generated yet")).not.toBeNull();
  });

  it("a nested part is titled with its own name, not numbered as a scene (real failure 2026-10-02)", () => {
    renderWithLocale(
      <PlanCard
        entry={entry()}
        index={3}
        total={1}
        sceneNameByCompositionId={sceneNameByCompositionId}
        assetById={assetById}
        previewUrl={null}
        onEditPlan={() => {}}
        nestedPartName="Part 2"
      />
    );

    expect(screen.getByRole("heading", { name: "Part 2" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Main Scene" })).toBeNull();
    expect(screen.queryByText(/Template composition:/)).toBeNull();
  });
});

describe("the plan shows what the assistant did (real complaint 2026-10-02: nothing showed what was read or used)", () => {
  const summary = (overrides: Partial<WorkMapAiSummary> = {}): WorkMapAiSummary => ({
    websiteUrl: "https://example.com/",
    websiteRead: "READ",
    productName: "Acme",
    tagline: "Fast and safe",
    features: ["Results", "Slips"],
    tone: "official",
    notes: null,
    ...overrides
  });
  const logo = assetFixture({ id: "a-logo", originalFilename: "logo.png", mediaKind: "LOGO" }) as unknown as AssetDto;
  const clip = assetFixture({ id: "a-clip", originalFilename: "demo.mp4", mediaKind: "VIDEO", mimeType: "video/mp4" }) as unknown as AssetDto;

  it("says the website was read, and what was understood from it", () => {
    renderWithLocale(<AiPlanSummaryPanel aiSummary={summary()} assets={[]} usedAssetIds={new Set()} projectId="p1" />);
    expect(screen.getByText("✓ Read your website: https://example.com/")).not.toBeNull();
    expect(screen.getByText("Acme")).not.toBeNull();
    expect(screen.getByText("Fast and safe")).not.toBeNull();
    expect(screen.getByText("Results")).not.toBeNull();
    expect(screen.getByText("official")).not.toBeNull();
  });

  it("says plainly when the website could not be read - never implies it was", () => {
    renderWithLocale(<AiPlanSummaryPanel aiSummary={summary({ websiteRead: "FAILED" })} assets={[]} usedAssetIds={new Set()} projectId="p1" />);
    expect(screen.getByText(/Could not read your website \(https:\/\/example\.com\/\)/)).not.toBeNull();
    expect(screen.queryByText(/✓ Read your website/)).toBeNull();
  });

  it("says nothing about a website when none was given", () => {
    renderWithLocale(<AiPlanSummaryPanel aiSummary={summary({ websiteRead: "NOT_GIVEN", websiteUrl: null })} assets={[]} usedAssetIds={new Set()} projectId="p1" />);
    expect(screen.queryByText(/website/i)).toBeNull();
  });

  it("shows the client's own files as real pictures, each marked used or not used", () => {
    renderWithLocale(<AiPlanSummaryPanel aiSummary={null} assets={[logo, clip]} usedAssetIds={new Set(["a-logo"])} projectId="p1" />);
    // The picture is decorative (alt=""): the file's name is printed right under it, once.
    const pictures = document.querySelectorAll<HTMLImageElement>(".ai-used__file img");
    // A video is named, never given a broken picture.
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.src).toContain("/api/projects/p1/assets/a-logo/file");
    expect(pictures[0]?.alt).toBe("");
    expect(screen.getAllByText("logo.png")).toHaveLength(1);
    expect(screen.getByText("Used in this plan")).not.toBeNull();
    expect(screen.getByText("Not used")).not.toBeNull();
  });

  it("renders nothing at all for a hand-written plan with no files - no empty box", () => {
    const { container } = renderWithLocale(<AiPlanSummaryPanel aiSummary={null} assets={[]} usedAssetIds={new Set()} projectId="p1" />);
    expect(container.querySelector(".ai-used")).toBeNull();
  });

  it("a text layer shows what the template said beside what it will say", () => {
    const group = {
      compositionId: "c1",
      compositionName: "Part 1",
      plainTitle: null,
      rows: [{ entry: entry({ id: "r1", desiredText: "Acme" }), layerName: "Headline", kind: "text", currentText: "YOUR TITLE" }]
    };
    renderWithLocale(<LayerPlanCard group={group} assetById={new Map()} projectId="p1" />);
    expect(screen.getByText("Template says:")).not.toBeNull();
    expect(screen.getByText("YOUR TITLE")).not.toBeNull();
    expect(screen.getByText("Acme").tagName).toBe("STRONG");
  });

  // 2026-10-07: the card named layers as the template does ("Text A", "White Solid 2"); the client meets "Text 1" and "Picture" on the Scenes tab.
  it("a top-level scene is titled Scene N and its rows Text 1..N / Picture, with the template's own names on hover", () => {
    const group = {
      compositionId: "c1",
      compositionName: "Scene_03",
      plainTitle: { kind: "scene" as const, n: 3 },
      rows: [
        { entry: entry({ id: "r1", desiredText: "One" }), layerName: "Text A", kind: "text", currentText: "A" },
        { entry: entry({ id: "r2", desiredText: "Two" }), layerName: "Text B", kind: "text", currentText: "B" },
        { entry: entry({ id: "r3", desiredAssetId: "a-logo" }), layerName: "White Solid 2", kind: "image", currentText: null }
      ]
    };
    renderWithLocale(<LayerPlanCard group={group} assetById={new Map([["a-logo", logo]])} projectId="p1" />);
    expect(screen.getByText("Scene 3").getAttribute("title")).toBe("Scene_03");
    expect(screen.getByText("Text 1").getAttribute("title")).toBe("Text A");
    expect(screen.getByText("Text 2")).not.toBeNull();
    expect(screen.getByText("Picture").getAttribute("title")).toBe("White Solid 2");
    expect(screen.queryByText("Text A")).toBeNull();
  });

  it("an image layer shows the chosen file as a picture", () => {
    const group = {
      compositionId: "c1",
      compositionName: "Part 1",
      plainTitle: null,
      rows: [{ entry: entry({ id: "r1", desiredAssetId: "a-logo" }), layerName: "Screen", kind: "image", currentText: null }]
    };
    renderWithLocale(<LayerPlanCard group={group} assetById={new Map([["a-logo", logo]])} projectId="p1" />);
    expect((screen.getByRole("img", { name: "logo.png" }) as HTMLImageElement).src).toContain("/assets/a-logo/file");
  });
});
