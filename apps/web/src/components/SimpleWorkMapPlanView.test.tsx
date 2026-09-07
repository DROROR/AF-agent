// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkMapEntry } from "@dyo/schemas";
import { PlanCard } from "./SimpleWorkMapPlanView";
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
});
