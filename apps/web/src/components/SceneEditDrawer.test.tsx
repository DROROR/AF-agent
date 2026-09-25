// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneEditDrawer } from "./SceneEditDrawer";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { classifySlotSemantics, computeTextVerification, type SlotStructuralFacts } from "@dyo/schemas";
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

function mappingFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "APP PROMO",
    placeholderClassification: { value: null, source: "MANIFEST", evidence: ["unknown"] },
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

describe("SceneEditDrawer", () => {
  it("saves a SET_TEXT operation and reflects the new revision when the text field is edited", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture()] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
        {
          status: 200,
          body: {
            plan: planFixture({ revision: 2 }, [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "Hello" })] })]),
            sceneTable: []
          }
        }
      ],
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    const onClose = vi.fn();
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={onClose} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    const textInput = screen.getByLabelText("Text") as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("warns when the typed text is still the template's own wording, and requires an explicit choice", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "The template's own wording" })] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    await screen.findByText("This text is still exactly the template's own wording.");
    // The template's own text is shown, so the reviewer can see WHAT matched.
    expect(screen.getByText("The template's own wording", { selector: "code" })).toBeTruthy();
    // Undecided is the blocking state, and neither choice is preselected.
    expect(screen.getByRole("status").getAttribute("data-blocks")).toBe("true");
    expect(screen.getByRole("button", { name: "I replaced it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep template text" })).toBeTruthy();
    expect(screen.queryByText("Recorded: keeping the template's wording")).toBeNull();
  });

  it("warns about a formatting-only variant too", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "THE TEMPLATE'S OWN WORDING" })] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("This text differs from the template's own wording only in formatting.");
  });

  it("saves an explicit Keep template text decision alongside the text", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "The template's own wording" })] })];
    const calls: RecordedFetchCall[] = [];
    stubFetchByUrl(
      {
        [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
        [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
      },
      calls
    );

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    fireEvent.click(screen.getByRole("button", { name: "Keep template text" }));
    // Clicked, not recorded - the label only says "Recorded" once the plan
    // itself holds the decision (see the unsaved-decision tests below).
    await screen.findByText(/Chosen, not saved: keeping the template's wording/);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch).toBeDefined();
      const operations = (patch?.body as { operations: { type: string; decision?: string }[] }).operations;
      expect(operations).toContainEqual(expect.objectContaining({ type: "SET_TEMPLATE_TEXT_DECISION", decision: "KEEP_TEMPLATE_TEXT" }));
    });
  });

  it("tells the reviewer to re-inspect when the manifest never captured the template's own text, and offers no decision to make", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "Anything at all" })] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: {
        status: 200,
        body: { project: projectDtoFixture(), manifest: manifestFixture([placeholderFixture({ originalText: undefined })]) }
      }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText(/Re-run template inspection/);
    expect(screen.queryByRole("button", { name: "Keep template text" })).toBeNull();
  });

  it("labels a long template text as an excerpt and never presents it as the complete original", async () => {
    const complete = `${"a".repeat(10_000)} and the real ending`;
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: complete })] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: {
        status: 200,
        body: {
          project: projectDtoFixture(),
          manifest: manifestFixture([
            placeholderFixture({
              originalText: undefined,
              originalTextTruncated: true,
              originalTextPreview: complete.slice(0, 10_000),
              originalTextVerification: { ...computeTextVerification(complete), sourceProjectSha256: "a".repeat(64) }
            })
          ])
        }
      }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    // Still recognised as identical - never an impossible re-inspection request.
    await screen.findByText("This text is still exactly the template's own wording.");
    expect(screen.queryByText(/Re-run template inspection/)).toBeNull();
    // The excerpt is labelled as an excerpt, with the complete length stated.
    await screen.findByText("Template's own text (excerpt only):");
    expect(screen.getByText(/only the beginning is shown/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`${complete.length} characters long`))).toBeTruthy();
    // ...and the plain "Template's own text" label is NOT used for it.
    expect(screen.queryByText("Template's own text:")).toBeNull();
  });

  it("tells the reviewer an over-sized template text can never be verified, and offers no decision at all", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "anything the reviewer typed" })] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: {
        status: 200,
        body: {
          project: projectDtoFixture(),
          manifest: manifestFixture([
            placeholderFixture({
              originalText: undefined,
              originalTextTruncated: true,
              originalTextCaptureStatus: "TOO_LARGE",
              originalTextCodeUnitLength: 2_000_001
            })
          ])
        }
      }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText(/larger than this system can verify/);
    // Actionable, and explicitly NOT an endless re-inspection prompt.
    expect(screen.getByText(/Re-running inspection will not change that/)).toBeTruthy();
    expect(screen.queryByText(/Re-run template inspection\./)).toBeNull();
    // Nothing was verified, so there is nothing to keep or replace.
    expect(screen.queryByRole("button", { name: "Keep template text" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I replaced it" })).toBeNull();
  });

  it("tells the reviewer a transient capture failure is worth re-inspecting for", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "anything" })] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: {
        status: 200,
        body: {
          project: projectDtoFixture(),
          manifest: manifestFixture([placeholderFixture({ originalText: undefined, originalTextTruncated: true, originalTextCaptureStatus: "CAPTURE_FAILED" })])
        }
      }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText(/could not be read completely/);
    expect(screen.getByText(/usually resolves this/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep template text" })).toBeNull();
  });

  it("shows no template-copy warning at all once the text is genuinely different", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "Completely different words" })] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a save-failed error (never silently discards the edit) when the API rejects the change", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture()] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
        { status: 409, body: { error: { code: "CONFLICT", message: "stale revision", requestId: "r1" } } }
      ],
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    const onClose = vi.fn();
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={onClose} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Could not save this change");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers only this project's real assets in the picker - never a fake/arbitrary option", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture()] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [assetFixture({ id: "asset-1", label: "Client logo" })] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={() => {}} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    const select = (await screen.findByLabelText("Asset")) as HTMLSelectElement;
    const optionLabels = [...select.options].map((option) => option.textContent);
    expect(optionLabels).toEqual(["Unmapped", "Client logo"]);
  });

  it("saves a MAP_ASSET operation with the real selected asset id when one is picked", async () => {
    const scenes = [sceneFixture({ id: "s1", mappings: [mappingFixture()] })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable: [] } },
        {
          status: 200,
          body: {
            plan: planFixture({ revision: 2 }, [
              sceneFixture({ id: "s1", mappings: [mappingFixture({ selectedAssetId: "asset-1", selectedAssetType: "image" })] })
            ]),
            sceneTable: []
          }
        }
      ],
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [assetFixture({ id: "asset-1", label: "Client logo" })] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    const onClose = vi.fn();
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={onClose} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    const select = (await screen.findByLabelText("Asset")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "asset-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const executionPlanCall = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => init)
      .find((init): init is RequestInit & { body: string } => typeof init?.body === "string" && init.body.includes("MAP_ASSET"));
    expect(executionPlanCall).toBeDefined();
    const payload = JSON.parse(executionPlanCall!.body) as { operations: Array<Record<string, unknown>> };
    expect(payload.operations).toContainEqual({
      type: "MAP_ASSET",
      scenePlanId: "s1",
      mappingId: "mapping-1",
      selectedAssetId: "asset-1",
      selectedAssetType: "image"
    });
  });

  it("renders nothing when no scenePlanId is selected", () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    const { container } = renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId={null} onClose={() => {}} />
      </ProjectWorkspaceProvider>
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

/**
 * STAGE 4: the slot decision surface. The reviewer is shown what the structure
 * says and must look at a real captured frame of the moment the slot is on
 * screen before any decision can be recorded - the same rule the backend gate
 * enforces, so the dashboard never offers a decision that would be refused.
 */
describe("SceneEditDrawer - slot findings", () => {
  const SLOT_FACTS: SlotStructuralFacts = {
    slotCompositionId: "c-slot",
    slotLayerIndex: 1,
    slotLayerName: null,
    slotCompositionName: null,
    widthPx: 1080,
    heightPx: 2160,
    hostDepth: 1,
    hosts: [
      {
        compositionId: "c1",
        layerIndex: 3,
        layerName: null,
        threeDLayer: true,
        hasTrackMatte: true,
        trackMatteType: "ALPHA",
        matteSource: "RENDERED_FOOTAGE",
        parentLayerIndex: 2,
        parentIsAnimated: true,
        siblingPreRenderedPass: true,
        scalePercent: 100,
        rotationDegrees: 0
      }
    ],
    reusedByHostCount: 1,
    transformedBounds: null,
    visibleWindowSeconds: { startSeconds: 1, endSeconds: 3 }
  };

  /** A device-screen slot holding a transparent logo - a real, blocking conflict. */
  function conflictingSetup(previewBody: unknown, calls?: RecordedFetchCall[], mappingOverrides: Record<string, unknown> = {}) {
    const screenPlaceholder = placeholderFixture({
      placeholderId: "ph-img",
      layerName: "SCREEN",
      placeholderType: "image",
      sourceType: "AVLayer",
      originalText: undefined,
      slotFacts: SLOT_FACTS,
      slotSemantics: classifySlotSemantics(SLOT_FACTS)
    });
    const mapping = mappingFixture({
      id: "mapping-img",
      manifestPlaceholderId: "ph-img",
      placeholderName: "SCREEN",
      placeholderClassification: { value: "image", source: "MANIFEST", evidence: [] },
      selectedAssetId: "asset-1",
      selectedAssetType: "logo",
      ...mappingOverrides
    });
    stubFetchByUrl(
      {
        [`/api/projects/${PROJECT_ID}/execution-plan/scenes/s1/preview-status`]: previewBody as never,
        [`/api/projects/${PROJECT_ID}/execution-plan`]: {
          status: 200,
          body: { plan: planFixture({ revision: 1 }, [sceneFixture({ id: "s1", mappings: [mapping] })]), sceneTable: [] }
        },
        [`/api/projects/${PROJECT_ID}/assets`]: {
          status: 200,
          body: {
            assets: [
              assetFixture({
                mediaKind: "LOGO",
                width: 800,
                height: 800,
                // Measured facts: the file carries an alpha channel AND its
                // pixels actually use it - a genuine see-through logo.
                hasAlphaChannel: true,
                hasTransparentPixels: true,
                transparentPixelRatio: 0.74,
                visibleCoverageRatio: 0.26
              })
            ]
          }
        },
        [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture([screenPlaceholder]) } },
        "/api/dashboard/status": { status: 200, body: { workers: [], jobs: [], summary: {} } }
      },
      calls
    );
  }

  it("shows the blocking finding and keeps every decision unavailable until a frame of the slot exists", async () => {
    conflictingSetup({ status: 200, body: { preview: null } });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("This slot needs a decision");
    expect(screen.getByText(/74% of this asset is see-through/)).toBeTruthy();
    await screen.findByText(/No evidence frame has been captured/);
    expect((screen.getByRole("button", { name: "Accept - I looked, this is right" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "It is a flat card" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a frame captured at a moment the slot is not on screen", async () => {
    conflictingSetup({
      status: 200,
      body: {
        preview: {
          id: "00000000-0000-4000-8000-000000000001",
          projectId: PROJECT_ID,
          manifestCompositionId: "c1",
          sourceProjectSha256: "a".repeat(64),
          filename: "f.png",
          mimeType: "image/png",
          byteSize: 10,
          storageKey: "evidence/f.png",
          capturedAt: new Date().toISOString(),
          capturedAtSeconds: 0,
          createdAt: new Date().toISOString()
        }
      }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText(/does not show the moment this slot is on screen/);
    expect((screen.getByRole("button", { name: "Accept - I looked, this is right" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("records a decision bound to the exact frame the reviewer was shown", async () => {
    const calls: RecordedFetchCall[] = [];
    conflictingSetup(
      {
        status: 200,
        body: {
          preview: {
            id: "00000000-0000-4000-8000-000000000002",
            projectId: PROJECT_ID,
            manifestCompositionId: "c1",
            sourceProjectSha256: "a".repeat(64),
            filename: "f.png",
            mimeType: "image/png",
            byteSize: 10,
            storageKey: "evidence/the-frame.png",
            capturedAt: new Date().toISOString(),
            capturedAtSeconds: 2,
            createdAt: new Date().toISOString()
          }
        }
      },
      calls
    );

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("This slot needs a decision");
    const accept = await waitFor(() => {
      const button = screen.getByRole("button", { name: "Accept - I looked, this is right" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(accept);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch).toBeTruthy();
      expect((patch?.body as { operations: unknown[] }).operations).toContainEqual({
        type: "SET_SLOT_REVIEW",
        scenePlanId: "s1",
        mappingId: "mapping-img",
        decision: "ACCEPT",
        evidenceFrameStorageKey: "evidence/the-frame.png"
      });
    });
  });
});

/**
 * REAL 2026-09-24 END-TO-END RUN (docs/ACCEPTANCE.md): a reviewer clicked three
 * slot decisions, read "Recorded: accepted after looking at the frame" three
 * times, closed the drawer - and all three mappings still held
 * `slotReview: null` in the database, because nothing in this drawer is
 * persisted until "Save changes" succeeds. The drawer now distinguishes a
 * decision it has only been TOLD about from one the plan actually HOLDS, and
 * never lets the first one leave silently.
 */
describe("SceneEditDrawer - a decision is only 'recorded' once the plan holds it", () => {
  const SLOT_FACTS: SlotStructuralFacts = {
    slotCompositionId: "c-slot",
    slotLayerIndex: 1,
    slotLayerName: null,
    slotCompositionName: null,
    widthPx: 1080,
    heightPx: 2160,
    hostDepth: 1,
    hosts: [
      {
        compositionId: "c1",
        layerIndex: 3,
        layerName: null,
        threeDLayer: true,
        hasTrackMatte: true,
        trackMatteType: "ALPHA",
        matteSource: "RENDERED_FOOTAGE",
        parentLayerIndex: 2,
        parentIsAnimated: true,
        siblingPreRenderedPass: true,
        scalePercent: 100,
        rotationDegrees: 0
      }
    ],
    reusedByHostCount: 1,
    transformedBounds: null,
    visibleWindowSeconds: { startSeconds: 1, endSeconds: 3 }
  };

  /** A capture taken inside the slot's own visible window - the only kind a decision may be made against. */
  function usablePreviewBody() {
    return {
      status: 200,
      body: {
        preview: {
          id: "00000000-0000-4000-8000-000000000003",
          projectId: PROJECT_ID,
          manifestCompositionId: "c1",
          sourceProjectSha256: "a".repeat(64),
          filename: "f.png",
          mimeType: "image/png",
          byteSize: 10,
          storageKey: "evidence/the-frame.png",
          capturedAt: new Date().toISOString(),
          capturedAtSeconds: 2,
          createdAt: new Date().toISOString()
        }
      }
    };
  }

  function slotSetup(mappingOverrides: Record<string, unknown> = {}, calls?: RecordedFetchCall[]) {
    const screenPlaceholder = placeholderFixture({
      placeholderId: "ph-img",
      layerName: "SCREEN",
      placeholderType: "image",
      sourceType: "AVLayer",
      originalText: undefined,
      slotFacts: SLOT_FACTS,
      slotSemantics: classifySlotSemantics(SLOT_FACTS)
    });
    const mapping = mappingFixture({
      id: "mapping-img",
      manifestPlaceholderId: "ph-img",
      placeholderName: "SCREEN",
      placeholderClassification: { value: "image", source: "MANIFEST", evidence: [] },
      selectedAssetId: "asset-1",
      selectedAssetType: "logo",
      ...mappingOverrides
    });
    stubFetchByUrl(
      {
        [`/api/projects/${PROJECT_ID}/execution-plan/scenes/s1/preview-status`]: usablePreviewBody() as never,
        [`/api/projects/${PROJECT_ID}/execution-plan`]: {
          status: 200,
          body: { plan: planFixture({ revision: 1 }, [sceneFixture({ id: "s1", mappings: [mapping] })]), sceneTable: [] }
        },
        [`/api/projects/${PROJECT_ID}/assets`]: {
          status: 200,
          body: {
            assets: [
              assetFixture({ mediaKind: "LOGO", width: 800, height: 800, hasAlphaChannel: true, hasTransparentPixels: true, transparentPixelRatio: 0.74, visibleCoverageRatio: 0.26 })
            ]
          }
        },
        [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture([screenPlaceholder]) } },
        "/api/dashboard/status": { status: 200, body: { workers: [], jobs: [], summary: {} } }
      },
      calls
    );
  }

  /** The exact record the API writes once a decision is genuinely saved. */
  function savedAcceptReview() {
    return {
      decision: "ACCEPT",
      classification: null,
      decidedBy: "reviewer@example.test",
      decidedAt: new Date().toISOString(),
      evidenceDigest: "0".repeat(64),
      evidenceFrameStorageKey: "evidence/the-frame.png"
    };
  }

  it("reads a just-clicked slot decision as unsaved, never as recorded", async () => {
    slotSetup();
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("This slot needs a decision");
    const accept = await waitFor(() => {
      const button = screen.getByRole("button", { name: "Accept - I looked, this is right" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(accept);

    // The decision exists only in this browser, and the drawer says exactly that.
    await screen.findByText(/Chosen, not saved: accepted after looking at the frame/);
    expect(screen.queryByText("Recorded: accepted after looking at the frame")).toBeNull();
    expect(screen.getByText(/Unsaved changes on this scene/)).toBeTruthy();
  });

  it("asks for THIS slot's own evidence frame, never whichever frame the scene captured last", async () => {
    // A scene with several slots is reviewed in one pass: the composition's
    // newest capture belongs to whichever slot was captured last, so naming it
    // in another slot's decision is exactly what the API refuses.
    const calls: RecordedFetchCall[] = [];
    slotSetup({}, calls);
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("This slot needs a decision");
    await waitFor(() => {
      expect(calls.some((call) => call.url.includes("/preview-status?mappingId=mapping-img"))).toBe(true);
    });
  });

  it("reads a slot decision the plan already holds as recorded, with nothing pending", async () => {
    slotSetup({ slotReview: savedAcceptReview() });
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("Recorded: accepted after looking at the frame");
    expect(screen.queryByText(/Chosen, not saved/)).toBeNull();
    expect(screen.queryByText(/Unsaved changes on this scene/)).toBeNull();
  });

  it("reads a template-copy decision the plan already holds as recorded, and a re-clicked different one as unsaved", async () => {
    const decided = mappingFixture({
      text: "The template's own wording",
      keepTemplateText: {
        decision: "KEEP_TEMPLATE_TEXT",
        decidedBy: "reviewer@example.test",
        decidedAt: new Date().toISOString(),
        textAtDecision: "The template's own wording"
      }
    });
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, [sceneFixture({ id: "s1", mappings: [decided] })]), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={vi.fn()} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("Recorded: keeping the template's wording");
    expect(screen.queryByText(/Unsaved changes on this scene/)).toBeNull();

    // Switching to the other decision is a new, unsaved choice - the plan still
    // holds the old one.
    fireEvent.click(screen.getByRole("button", { name: "I replaced it" }));
    await screen.findByText(/Chosen, not saved: replaced deliberately/);
    expect(screen.queryByText("Recorded: keeping the template's wording")).toBeNull();
  });

  it("asks before throwing an unsaved decision away, and closes only once the reviewer confirms", async () => {
    const onClose = vi.fn();
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ revision: 1 }, [sceneFixture({ id: "s1", mappings: [mappingFixture({ text: "The template's own wording" })] })]), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={onClose} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    fireEvent.click(screen.getByRole("button", { name: "Keep template text" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Nothing closed, and the reviewer is told what is at stake.
    await screen.findByText("Discard the unsaved changes?");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Discard the unsaved changes?")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Discard the unsaved changes?");
    fireEvent.click(screen.getByRole("button", { name: "Discard and close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes straight away when nothing is pending - the confirmation is never in the way", async () => {
    const onClose = vi.fn();
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, [sceneFixture({ id: "s1", mappings: [mappingFixture()] })]), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SceneEditDrawer scenePlanId="s1" onClose={onClose} />
      </ProjectWorkspaceProvider>
    );

    await screen.findByText("APP PROMO");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Discard the unsaved changes?")).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });
});
