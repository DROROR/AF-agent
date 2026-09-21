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
    await screen.findByText("Recorded: keeping the template's wording");
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
  function conflictingSetup(previewBody: unknown, calls?: RecordedFetchCall[]) {
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
      selectedAssetType: "logo"
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
          body: { assets: [assetFixture({ mediaKind: "LOGO", width: 800, height: 800, hasAlpha: true })] }
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
    expect(screen.getByText(/transparent background/)).toBeTruthy();
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
