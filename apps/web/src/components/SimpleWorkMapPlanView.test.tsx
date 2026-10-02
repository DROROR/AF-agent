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
    const picture = screen.getByRole("img", { name: "logo.png" }) as HTMLImageElement;
    expect(picture.src).toContain("/api/projects/p1/assets/a-logo/file");
    // A video is named, never given a broken picture.
    expect(screen.queryByRole("img", { name: "demo.mp4" })).toBeNull();
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
      rows: [{ entry: entry({ id: "r1", desiredText: "Acme" }), layerName: "Headline", kind: "text", currentText: "YOUR TITLE" }]
    };
    renderWithLocale(<LayerPlanCard group={group} assetById={new Map()} projectId="p1" />);
    expect(screen.getByText("Template says:")).not.toBeNull();
    expect(screen.getByText("YOUR TITLE")).not.toBeNull();
    expect(screen.getByText("Acme").tagName).toBe("STRONG");
  });

  it("an image layer shows the chosen file as a picture", () => {
    const group = {
      compositionId: "c1",
      compositionName: "Part 1",
      rows: [{ entry: entry({ id: "r1", desiredAssetId: "a-logo" }), layerName: "Screen", kind: "image", currentText: null }]
    };
    renderWithLocale(<LayerPlanCard group={group} assetById={new Map([["a-logo", logo]])} projectId="p1" />);
    expect((screen.getByRole("img", { name: "logo.png" }) as HTMLImageElement).src).toContain("/assets/a-logo/file");
  });
});
