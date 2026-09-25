// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReelsLayoutCard } from "./ReelsLayoutCard";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  SOURCE_SHA,
  manifestFixture,
  placeholderFixture,
  planFixture,
  projectDtoFixture,
  sceneFixture,
  stubFetchByUrl,
  type RecordedFetchCall
} from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const WORKER_ID = "44444444-4444-4444-4444-444444444444";
const JOB_ID = "11111111-1111-1111-1111-111111111111";

function worker() {
  return {
    workerId: WORKER_ID,
    name: "worker-a",
    status: "ONLINE",
    lastHeartbeatAt: new Date().toISOString(),
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeAvailability: "ONLINE",
    mcpAvailability: "ONLINE",
    aeVersion: "26.0",
    capabilities: ["INSPECT_SCENE_EVIDENCE"],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/** One layer exactly as the real describeLayerTransforms scan reports it - nothing here is a shape this dashboard invented. */
function layerFact(overrides: Record<string, unknown> = {}) {
  return {
    layerIndex: 1,
    layerName: "a layer",
    enabled: true,
    threeDLayer: false,
    isCameraLayer: false,
    position: { animated: false, currentValue: [640, 360], keyframes: null },
    scale: { animated: false, currentValue: [100, 100], keyframes: null },
    rotation: { animated: false, currentValue: 0, keyframes: null },
    anchorPoint: { animated: false, currentValue: [0, 0], keyframes: null },
    pointOfInterest: null,
    zoom: null,
    effects: [],
    ...overrides
  };
}

function jobBody(status: string, layerTransformFacts: unknown) {
  return {
    status: 200,
    body: {
      job: {
        jobId: JOB_ID,
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        operation: "INSPECT_SCENE_EVIDENCE",
        status,
        payload: {},
        result:
          status !== "SUCCEEDED"
            ? null
            : {
                verifiedSourceProjectSha256: SOURCE_SHA,
                manifestCompositionId: "c1",
                aeProjectItemIndex: 1,
                compositionName: "Scene 01",
                layers: [],
                preview: null,
                previewFailureReason: null,
                layerDetails: null,
                layerDetailsFailureReason: null,
                capturedAt: new Date().toISOString(),
                layerTransformFacts
              },
        error: null,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        claimedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: status === "SUCCEEDED" ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString()
      }
    }
  };
}

function setup(options: { layerFacts?: unknown[]; reelsLayout?: unknown; calls?: RecordedFetchCall[] } = {}): void {
  const scene = sceneFixture({ id: "s1", manifestCompositionId: "c1", ...(options.reelsLayout === undefined ? {} : { reelsLayout: options.reelsLayout }) });
  stubFetchByUrl(
    {
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker()] } },
      [`/api/jobs/${JOB_ID}`]: jobBody("SUCCEEDED", options.layerFacts ?? [layerFact()]),
      "/api/jobs": { status: 201, body: { jobId: JOB_ID, workerId: WORKER_ID, operation: "INSPECT_SCENE_EVIDENCE", status: "QUEUED", createdAt: new Date().toISOString() } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, [scene]), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: {
        status: 200,
        body: {
          project: projectDtoFixture({ sourceWorkerId: WORKER_ID }),
          manifest: manifestFixture([placeholderFixture({ placeholderId: "ph-1", compositionId: "c1", layerIndex: 1 })])
        }
      }
    },
    options.calls
  );
}

function renderCard(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ReelsLayoutCard />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

/** Picks the scene and runs the read-only layer scan, the way a reviewer starts every layout. */
async function chooseSceneAndReadLayers(): Promise<void> {
  const scenePicker = await screen.findByLabelText("Scene");
  fireEvent.change(scenePicker, { target: { value: "s1" } });
  fireEvent.click(await screen.findByRole("button", { name: "Read this scene's layers" }));
  await screen.findByText("Layers in this scene", {}, { timeout: 10_000 });
}

/**
 * THE NATIVE REELS LAYOUT SURFACE.
 *
 * Zero Reels compositions had ever been built (docs/ACCEPTANCE.md,
 * 2026-09-24) - not because the build was missing, but because no screen ever
 * asked a human for the layout it needs. These tests hold the one rule that
 * made this screen non-obvious: the coordinates are a HUMAN decision, so the
 * dashboard shows facts and never produces a number of its own.
 */
describe("ReelsLayoutCard", () => {
  it("never pre-fills a coordinate: the fields start empty next to the real current values, and nothing can be saved until the reviewer types them", async () => {
    setup();
    renderCard();
    await chooseSceneAndReadLayers();

    // The scan's real values are shown as context...
    expect(screen.getByText(/position 640, 360/)).toBeTruthy();
    expect(screen.getByText(/scale 100, 100/)).toBeTruthy();

    // ...and not one of them has been copied into a field.
    fireEvent.click(screen.getByLabelText("Move this layer in the vertical frame"));
    expect((screen.getByLabelText("X (pixels)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Y (pixels)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Scale (%)") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Save this Reels layout" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves exactly the layers ticked and the numbers typed, against the manifest's own placeholder for that layer", async () => {
    const calls: RecordedFetchCall[] = [];
    setup({ calls });
    renderCard();
    await chooseSceneAndReadLayers();

    fireEvent.click(screen.getByLabelText("Move this layer in the vertical frame"));
    fireEvent.change(screen.getByLabelText("X (pixels)"), { target: { value: "540" } });
    fireEvent.change(screen.getByLabelText("Y (pixels)"), { target: { value: "960" } });
    fireEvent.change(screen.getByLabelText("Scale (%)"), { target: { value: "75" } });
    fireEvent.change(screen.getByLabelText("Name for the vertical composition"), { target: { value: "a name the reviewer chose" } });

    const save = screen.getByRole("button", { name: "Save this Reels layout" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch).toBeTruthy();
      expect((patch?.body as { operations: unknown[] }).operations).toContainEqual({
        type: "SET_REELS_LAYOUT",
        scenePlanId: "s1",
        reelsCompositionName: "a name the reviewer chose",
        layerTransforms: [{ layerIndex: 1, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 75 }]
      });
    });
  });

  it("offers no target at all for a layer whose position or scale is keyframed, and says why the build would refuse it", async () => {
    setup({
      layerFacts: [
        layerFact({
          layerIndex: 2,
          layerName: "an animated layer",
          position: { animated: true, currentValue: [640, 360], keyframes: [{ timeSeconds: 0, value: [640, 360] }] }
        })
      ]
    });
    renderCard();
    await chooseSceneAndReadLayers();

    expect(screen.getByText(/refuses to write a fixed position over keyframed animation/)).toBeTruthy();
    expect(screen.queryByLabelText("Move this layer in the vertical frame")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save this Reels layout" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save this Reels layout" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no target for a layer whose transform could not be read either - a camera has no scale of its own", async () => {
    setup({ layerFacts: [layerFact({ layerIndex: 3, layerName: "a camera", isCameraLayer: true, scale: null, rotation: null })] });
    renderCard();
    await chooseSceneAndReadLayers();

    expect(screen.getByText(/could not be read/)).toBeTruthy();
    expect(screen.queryByLabelText("Move this layer in the vertical frame")).toBeNull();
  });

  it("warns when a typed position falls outside the fixed 1080x1920 frame, without blocking it", async () => {
    setup();
    renderCard();
    await chooseSceneAndReadLayers();

    fireEvent.click(screen.getByLabelText("Move this layer in the vertical frame"));
    fireEvent.change(screen.getByLabelText("X (pixels)"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Y (pixels)"), { target: { value: "960" } });
    fireEvent.change(screen.getByLabelText("Scale (%)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Name for the vertical composition"), { target: { value: "a name" } });

    expect(screen.getByText(/falls outside the 1080×1920 frame/)).toBeTruthy();
    // A deliberate off-frame placement is the reviewer's to make.
    expect((screen.getByRole("button", { name: "Save this Reels layout" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a layout the plan already holds, and can remove it", async () => {
    const calls: RecordedFetchCall[] = [];
    setup({
      calls,
      reelsLayout: {
        reelsCompositionName: "the saved name",
        layerTransforms: [{ layerIndex: 1, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 75 }],
        configuredAt: new Date().toISOString()
      }
    });
    renderCard();

    const scenePicker = await screen.findByLabelText("Scene");
    fireEvent.change(scenePicker, { target: { value: "s1" } });

    await screen.findByText("Composition name: the saved name");
    expect(screen.getByText("Layer 1 at 540, 960, scale 75%")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove this Reels layout" }));
    await waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect((patch?.body as { operations: unknown[] })?.operations).toContainEqual({ type: "CLEAR_REELS_LAYOUT", scenePlanId: "s1" });
    });
  });

  it("says plainly when there is no scene to lay out yet", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker()] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, [sceneFixture({ id: "s1", use: false })]), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture({ sourceWorkerId: WORKER_ID }), manifest: manifestFixture() } }
    });
    renderCard();

    await screen.findByText("No scenes to lay out");
    expect(screen.queryByLabelText("Scene")).toBeNull();
  });
});
