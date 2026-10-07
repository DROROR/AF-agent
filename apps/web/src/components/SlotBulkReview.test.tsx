// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifySlotSemantics, type SlotStructuralFacts } from "@dyo/schemas";
import { SlotBulkReview } from "./SlotBulkReview";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  assetFixture,
  manifestFixture,
  placeholderFixture,
  type RecordedFetchCall,
  planFixture,
  projectDtoFixture,
  sceneFixture,
  stubFetchByUrl
} from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * REAL 2026-10-04 SESSION: eleven pictures each needed their own decision in
 * their own scene's drawer. This puts them on one screen - and must never
 * loosen the rule that a decision names the frame the reviewer was shown.
 */

/** A slot whose structure does not say what it is - a made-up shape, not any template's. */
const UNSURE_SLOT: SlotStructuralFacts = {
  slotCompositionId: "c-slot",
  slotLayerIndex: 1,
  slotLayerName: null,
  slotCompositionName: null,
  widthPx: 600,
  heightPx: 1200,
  hostDepth: 1,
  hosts: [
    {
      compositionId: "c1",
      layerIndex: 3,
      layerName: null,
      threeDLayer: false,
      hasTrackMatte: false,
      trackMatteType: "NO_TRACK_MATTE",
      matteSource: "NONE",
      parentLayerIndex: null,
      parentIsAnimated: null,
      siblingPreRenderedPass: null,
      scalePercent: 100,
      rotationDegrees: 0,
      enabled: true,
      inFrame: true,
      windowSeconds: { startSeconds: 1, endSeconds: 3 },
      opacityPercentAtInPoint: 100,
      opacityKeyframes: null
    }
  ],
  reusedByHostCount: 1,
  transformedBounds: null,
  visibleWindowSeconds: { startSeconds: 1, endSeconds: 3 }
};

function mapping(id: string, placeholderId: string) {
  return {
    id,
    manifestPlaceholderId: placeholderId,
    placeholderName: `Picture ${id}`,
    placeholderClassification: { value: "image", source: "MANIFEST", evidence: [] },
    selectedAssetId: "asset-1",
    selectedAssetType: "image",
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function frame(storageKey: string, capturedAtSeconds: number, slotMappingId: string | null = null) {
  return {
    slotMappingId,
    id: "00000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    manifestCompositionId: "c1",
    sourceProjectSha256: "a".repeat(64),
    filename: "f.png",
    mimeType: "image/png",
    byteSize: 10,
    storageKey,
    capturedAt: new Date().toISOString(),
    capturedAtSeconds,
    createdAt: new Date().toISOString()
  };
}

function setup(previewBody: unknown, calls?: RecordedFetchCall[]) {
  const placeholders = ["ph-a", "ph-b"].map((placeholderId) =>
    placeholderFixture({
      placeholderId,
      layerName: "slot",
      placeholderType: "image",
      sourceType: "AVLayer",
      originalText: undefined,
      slotFacts: UNSURE_SLOT,
      slotSemantics: classifySlotSemantics(UNSURE_SLOT)
    })
  );
  stubFetchByUrl(
    {
      [`/api/projects/${PROJECT_ID}/execution-plan/scenes/s1/preview-status`]: previewBody as never,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ revision: 1 }, [sceneFixture({ id: "s1", mappings: [mapping("m-a", "ph-a"), mapping("m-b", "ph-b")] })]), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}/assets`]: {
        status: 200,
        body: { assets: [assetFixture({ width: 600, height: 1200, hasAlphaChannel: false, hasTransparentPixels: false, transparentPixelRatio: 0, visibleCoverageRatio: 1 })] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture(placeholders) } },
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } }
    },
    calls
  );
}

function renderReview(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SlotBulkReview />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

describe("SlotBulkReview", () => {
  it("with no frame of any slot, says how many pictures wait and offers to show them - never a confirm button", async () => {
    setup({ status: 200, body: { preview: null } });
    renderReview();

    await screen.findByText("Check where your 2 pictures will appear");
    expect(screen.getByRole("button", { name: "Show me all 2 spots" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /in the right place/ })).toBeNull();
  });

  it("a frame taken when the slot is not on screen is not evidence - still no confirm button", async () => {
    setup({ status: 200, body: { preview: frame("evidence/f.png", 0, "m-a") } });
    renderReview();

    await screen.findByText("Check where your 2 pictures will appear");
    await waitFor(() => expect(screen.getByRole("button", { name: "Show me all 2 spots" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /in the right place/ })).toBeNull();
  });

  it("REAL 2026-10-04: the scene's own preview, not captured for any slot, is not shown as a slot's evidence even when its moment is inside the window", async () => {
    setup({ status: 200, body: { preview: frame("evidence/scene.png", 2, null) } });
    renderReview();

    await waitFor(() => expect(screen.getByRole("button", { name: "Show me all 2 spots" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /in the right place/ })).toBeNull();
  });

  it("with a frame captured for the slot on screen, one press records the decision naming that frame - and only for that slot", async () => {
    const calls: RecordedFetchCall[] = [];
    setup({ status: 200, body: { preview: frame("evidence/shown.png", 2, "m-a") } }, calls);
    renderReview();

    fireEvent.click(await screen.findByRole("button", { name: "Yes - it is in the right place" }));

    await waitFor(() => {
      const edit = calls.find((call) => call.url.endsWith("/execution-plan") && call.method !== "GET" && call.body !== null);
      expect(edit).toBeDefined();
      const operations = (edit!.body as { operations: Record<string, unknown>[] }).operations;
      expect(operations).toEqual([
        { type: "SET_SLOT_REVIEW", scenePlanId: "s1", mappingId: "m-a", decision: "ACCEPT", evidenceFrameStorageKey: "evidence/shown.png" }
      ]);
    });
  });
});

/**
 * 2026-10-04: the captions under each picture were the template author's own
 * composition and layer names, which say nothing to a client, while the scene
 * cards on the same page said "Scene 3".
 */
describe("SlotBulkReview - captions a client can read", () => {
  function renderWithLabels(): void {
    renderWithLocale(
      <DashboardStatusProvider>
        <ProjectWorkspaceProvider projectId={PROJECT_ID}>
          <SlotBulkReview sceneLabelFor={() => "Scene 2"} />
        </ProjectWorkspaceProvider>
      </DashboardStatusProvider>
    );
  }

  it("names a picture by the scene it is in, numbered when the scene holds several, and keeps the template's names on hover", async () => {
    setup({ status: 200, body: { preview: frame("evidence/shown.png", 2, "m-a") } });
    renderWithLabels();

    await screen.findByRole("button", { name: "Yes - it is in the right place" });
    const caption = document.querySelector(".slot-bulk-review__grid figcaption") as HTMLElement;
    // Two pictures wait in this scene, so this one is numbered.
    // 2026-10-07: the caption also names the client's own file, so the frame without his picture in it is not all he sees.
    expect(caption.textContent).toBe('"logo.png" goes into the phone shown here (Picture 1 in Scene 2)');
    expect((caption.querySelector("img.slot-bulk-review__chosen") as HTMLImageElement).src).toContain("/file");
    expect(caption.getAttribute("title")).toContain("\u203A");
    expect((document.querySelector(".slot-bulk-review__grid img") as HTMLImageElement).alt).toBe("Picture 1 in Scene 2");
  });

  it("with no plain label to offer, falls back to the template's names exactly as before", async () => {
    setup({ status: 200, body: { preview: frame("evidence/shown.png", 2, "m-a") } });
    renderReview();

    await screen.findByRole("button", { name: "Yes - it is in the right place" });
    expect((document.querySelector(".slot-bulk-review__grid figcaption") as HTMLElement).textContent).toContain("\u203A");
  });

  it("only draws its button as the page's primary action when checking pictures is the current step", async () => {
    setup({ status: 200, body: { preview: null } });
    renderWithLocale(
      <DashboardStatusProvider>
        <ProjectWorkspaceProvider projectId={PROJECT_ID}>
          <SlotBulkReview isCurrentStep={false} />
        </ProjectWorkspaceProvider>
      </DashboardStatusProvider>
    );

    const button = await screen.findByRole("button", { name: "Show me all 2 spots" });
    expect(button.className).not.toContain("btn--primary");
  });
});
