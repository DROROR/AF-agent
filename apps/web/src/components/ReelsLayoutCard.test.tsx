// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReelsLayoutCard } from "./ReelsLayoutCard";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { ProjectGuidanceProvider } from "./ProjectGuidanceProvider";
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

/**
 * A real execution session exactly as GET .../execution-sessions/current
 * returns one. That endpoint only ever hands back a session bound to the
 * CURRENT plan revision, which is precisely the session a new revision
 * orphans - so its presence here is what "there is something to lose" means.
 */
function sessionBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "88888888-8888-8888-8888-888888888888",
    projectId: PROJECT_ID,
    executionPlanId: "plan-1",
    planRevision: 1,
    sourceProjectSha256: SOURCE_SHA,
    assignedWorkerId: WORKER_ID,
    status: "READY_TO_RENDER",
    latestWorkingProjectSha256: "d".repeat(64),
    completedScenePlanIds: ["s1"],
    firstPreviewApproved: true,
    fullPreviewApproved: true,
    hasPreview: true,
    latestPreviewScenePlanId: "s1",
    latestPreviewCapturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function setup(
  options: { layerFacts?: unknown[]; reelsLayout?: unknown; calls?: RecordedFetchCall[]; planStatus?: string; session?: unknown } = {}
): void {
  const scene = sceneFixture({ id: "s1", manifestCompositionId: "c1", ...(options.reelsLayout === undefined ? {} : { reelsLayout: options.reelsLayout }) });
  stubFetchByUrl(
    {
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker()] } },
      // The three reads ProjectGuidanceProvider already makes - stubbed, never
      // added: this card asks that provider what an edit would cost rather
      // than fetching anything of its own.
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: options.session ?? null } },
      [`/api/jobs/${JOB_ID}`]: jobBody("SUCCEEDED", options.layerFacts ?? [layerFact()]),
      "/api/jobs": { status: 201, body: { jobId: JOB_ID, workerId: WORKER_ID, operation: "INSPECT_SCENE_EVIDENCE", status: "QUEUED", createdAt: new Date().toISOString() } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ revision: 1, ...(options.planStatus === undefined ? {} : { status: options.planStatus }) }, [scene]), sceneTable: [] }
      },
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
        <ProjectGuidanceProvider projectId={PROJECT_ID}>
          <ReelsLayoutCard />
        </ProjectGuidanceProvider>
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
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 1 }, [sceneFixture({ id: "s1", use: false })]), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture({ sourceWorkerId: WORKER_ID }), manifest: manifestFixture() } }
    });
    renderCard();

    await screen.findByText("No scenes to lay out");
    expect(screen.queryByLabelText("Scene")).toBeNull();
  });

  /**
   * REAL 2026-09-27 INCIDENT (docs/ACCEPTANCE.md). Saving a Reels layout is a
   * plan edit: it writes a new plan revision, which returns the plan to DRAFT
   * and orphans the live execution session together with both of its preview
   * approvals. That is the approval model working correctly - but nothing on
   * screen said so, and the guidance's own recommended order put render
   * configuration AFTER the previews, so following the product's own advice
   * destroyed an approved plan and a completed session.
   *
   * THE PAIR IS THE TEST. A warning that always appears is noise people learn
   * to click through, and a warning that never appears is the incident again;
   * only proving both halves against real state is worth anything. Both cases
   * below drive the SAME form to the same save-ready state and differ in
   * nothing but the persisted plan status and whether a session exists.
   */
  describe("the plan-edit warning", () => {
    async function fillInASaveableLayout(): Promise<void> {
      await chooseSceneAndReadLayers();
      fireEvent.click(screen.getByLabelText("Move this layer in the vertical frame"));
      fireEvent.change(screen.getByLabelText("X (pixels)"), { target: { value: "540" } });
      fireEvent.change(screen.getByLabelText("Y (pixels)"), { target: { value: "960" } });
      fireEvent.change(screen.getByLabelText("Scale (%)"), { target: { value: "56" } });
      fireEvent.change(screen.getByLabelText("Name for the vertical composition"), { target: { value: "a name" } });
    }

    it("saves straight through, with no warning anywhere, while the plan is still a draft and no session exists - there is genuinely nothing to lose", async () => {
      const calls: RecordedFetchCall[] = [];
      setup({ calls, planStatus: "DRAFT", session: null });
      renderCard();
      await fillInASaveableLayout();

      // Nothing has been claimed about losing work before the click...
      expect(screen.queryByText(/undoes some of it/)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Save this Reels layout" }));

      // ...no confirmation is interposed...
      expect(screen.queryByRole("button", { name: "Save anyway" })).toBeNull();
      // ...and the edit really went out on that single click.
      await waitFor(() => {
        const patch = calls.find((call) => call.method === "PATCH");
        expect((patch?.body as { operations: { type: string }[] } | undefined)?.operations[0]?.type).toBe("SET_REELS_LAYOUT");
      });
    });

    it("names the approved plan, the running session and both preview approvals BEFORE saving, and sends nothing until the reviewer confirms", async () => {
      const calls: RecordedFetchCall[] = [];
      setup({ calls, planStatus: "APPROVED", session: sessionBody() });
      renderCard();
      await fillInASaveableLayout();

      // Stated beside the button, before it is pressed.
      await screen.findByText(/saving a Reels layout undoes some of it/);

      fireEvent.click(screen.getByRole("button", { name: "Save this Reels layout" }));

      // Every real consequence is itemised, and the plan is still untouched.
      await screen.findByText("Saving this Reels layout undoes approvals");
      screen.getByText("Send the plan back to Draft. The scenes have to be approved again.");
      screen.getByText("Drop the preview work in progress. The scenes have to be built again from the start.");
      screen.getByText("Cancel your approval of the first preview.");
      screen.getByText("Cancel your approval of the complete video preview.");
      screen.getByText("None of this happens if the Reels layout is set BEFORE the plan is approved.");
      expect(calls.find((call) => call.method === "PATCH")).toBeUndefined();

      // Going back really is a way out - still nothing sent.
      fireEvent.click(screen.getByRole("button", { name: "Go back" }));
      expect(screen.queryByText("Saving this Reels layout undoes approvals")).toBeNull();
      expect(calls.find((call) => call.method === "PATCH")).toBeUndefined();

      // And the edit goes out only on an explicit, informed confirmation.
      fireEvent.click(screen.getByRole("button", { name: "Save this Reels layout" }));
      fireEvent.click(await screen.findByRole("button", { name: "Save anyway" }));
      await waitFor(() => {
        const patch = calls.find((call) => call.method === "PATCH");
        expect((patch?.body as { operations: { type: string }[] } | undefined)?.operations[0]?.type).toBe("SET_REELS_LAYOUT");
      });
    });

    it("lists only what is genuinely at stake - an approved plan that never ran a session is told about the approval, and nothing else", async () => {
      setup({ planStatus: "APPROVED", session: null });
      renderCard();
      await fillInASaveableLayout();
      fireEvent.click(screen.getByRole("button", { name: "Save this Reels layout" }));

      await screen.findByText("Send the plan back to Draft. The scenes have to be approved again.");
      expect(screen.queryByText("Drop the preview work in progress. The scenes have to be built again from the start.")).toBeNull();
      expect(screen.queryByText("Cancel your approval of the first preview.")).toBeNull();
      expect(screen.queryByText("Cancel your approval of the complete video preview.")).toBeNull();
    });

    it("guards Remove exactly as it guards Save - the same plan revision, so the same warning", async () => {
      const calls: RecordedFetchCall[] = [];
      setup({
        calls,
        planStatus: "APPROVED",
        session: sessionBody(),
        reelsLayout: {
          reelsCompositionName: "the saved name",
          layerTransforms: [{ layerIndex: 1, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 56 }],
          configuredAt: new Date().toISOString()
        }
      });
      renderCard();
      fireEvent.change(await screen.findByLabelText("Scene"), { target: { value: "s1" } });
      await screen.findByText("Composition name: the saved name");

      fireEvent.click(screen.getByRole("button", { name: "Remove this Reels layout" }));
      await screen.findByText("Removing this Reels layout undoes approvals");
      expect(calls.find((call) => call.method === "PATCH")).toBeUndefined();

      fireEvent.click(screen.getByRole("button", { name: "Remove anyway" }));
      await waitFor(() => {
        const patch = calls.find((call) => call.method === "PATCH");
        expect((patch?.body as { operations: { type: string }[] } | undefined)?.operations[0]?.type).toBe("CLEAR_REELS_LAYOUT");
      });
    });
  });

  /**
   * REAL 2026-09-27: the first hand-made vertical render came out cut off at
   * both sides with empty bands above and below, because each layer's
   * position was mapped into the tall frame while its scale was left at the
   * original value. The card states the two facts that make that visible -
   * and states them without ever producing a number of its own, which is the
   * rule the whole screen is built on.
   */
  it("shows the scene's real size beside the fixed 1080x1920 target, and still pre-fills no scale", async () => {
    setup();
    renderCard();
    await chooseSceneAndReadLayers();

    expect(screen.getByText("This scene is 1920×1080 in the template. The frame you are placing it into is 1080×1920.")).toBeTruthy();
    expect(screen.getByText(/percentage of the layer's own original size/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Move this layer in the vertical frame"));
    expect((screen.getByLabelText("Scale (%)") as HTMLInputElement).value).toBe("");
  });
});
