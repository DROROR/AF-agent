// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectExportTab } from "./ProjectExportTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { WorkspaceModeProvider } from "./WorkspaceModeProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, SOURCE_SHA, manifestFixture, planFixture, projectDtoFixture, renderArtifactFixture, stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NO_WORKERS_STATUS = { "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } } };

function workerWithCapabilities(capabilities: string[]) {
  return {
    workerId: "44444444-4444-4444-4444-444444444444",
    name: "worker-a",
    status: "ONLINE",
    lastHeartbeatAt: new Date().toISOString(),
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeAvailability: "ONLINE",
    mcpAvailability: "ONLINE",
    aeVersion: "26.0",
    capabilities,
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function readyToRenderSession(workerId: string) {
  return {
    id: "88888888-8888-8888-8888-888888888888",
    projectId: PROJECT_ID,
    executionPlanId: "plan-1",
    planRevision: 3,
    sourceProjectSha256: SOURCE_SHA,
    assignedWorkerId: workerId,
    status: "READY_TO_RENDER",
    latestWorkingProjectSha256: "d".repeat(64),
    completedScenePlanIds: ["s1"],
    firstPreviewApproved: true,
    fullPreviewApproved: true,
    hasPreview: true,
    latestPreviewScenePlanId: "s1",
    latestPreviewCapturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function landscapeConfig(overrides: Record<string, unknown> = {}) {
  return {
    manifestCompositionId: "comp-landscape",
    aeProjectItemIndex: 3,
    compositionName: "Landscape Master",
    sourceProjectSha256: SOURCE_SHA,
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Source",
    configuredAt: new Date().toISOString(),
    ...overrides
  };
}

function renderTab(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <WorkspaceModeProvider>
        <ProjectWorkspaceProvider projectId={PROJECT_ID}>
          <ProjectExportTab />
        </ProjectWorkspaceProvider>
      </WorkspaceModeProvider>
    </DashboardStatusProvider>
  );
}

/**
 * "Export" tab (final MVP nav) - a plain-language render trigger, never
 * the raw composition/template-name configuration UI Advanced's Render
 * Settings tab exposes. These tests prove: an unconfigured/stale variant
 * shows a plain "not set up" message (never the raw fields), a configured
 * variant that isn't render-ready shows a plain "not ready" message, a
 * genuinely ready variant with an online worker dispatches RENDER with no
 * technical fields ever shown, and the real download/playback list
 * (FinalOutputsCard, reused unchanged from ProjectRenderSettingsTab) is
 * present on this tab too.
 */
describe("ProjectExportTab", () => {
  /**
   * THE DEAD END, PINNED (2026-09-26). Rendering is impossible until a
   * master composition is saved for an output, and until this change the
   * only form that could save one lived on the Render Settings tab - which
   * the normal nav does not list at all. So the Export button was greyed
   * out forever and the product's own advice was "switch to Advanced view".
   * The operator spent two days on the phone over exactly this.
   *
   * These two tests are the whole guarantee, and they are deliberately a
   * matched pair: the setup form is HERE for an output that is blocked on
   * it, and it is GONE for one that is not. Either alone would pass while
   * the dead end came back - the first would still pass if the form were
   * simply always shown (clutter for everyone), and the second would still
   * pass if the form were never shown at all (the original bug).
   */
  it("THE DEAD END: an output that cannot render without setup shows the real setup form in place, never a pointer to another tab", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ renderOutputs: { LANDSCAPE: null, REELS: null } }), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findAllByText("Not set up yet");

    // The real fields, on this tab, with a real Save - not a link, not an
    // instruction to change modes.
    expect(screen.getAllByLabelText("Master composition")).toHaveLength(2);
    expect(screen.getAllByLabelText("Render Settings template name")).toHaveLength(2);
    expect(screen.getAllByLabelText("Output Module template name")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(2);
    // And it no longer tells anyone to go somewhere else to do it.
    expect(document.body.textContent).not.toContain("Advanced view");
  });

  it("and the setup form disappears for an output that is already set up against the current template - it is a fix, not permanent clutter", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findByText("Not ready yet");

    // Only REELS is still missing its setup, so exactly one form is drawn.
    expect(screen.getAllByLabelText("Master composition")).toHaveLength(1);
  });

  it("shows a plain 'not set up yet' message (never the raw fields) when a variant has no render configuration", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ renderOutputs: { LANDSCAPE: null, REELS: null } }), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    const notConfigured = await screen.findAllByText("Not set up yet");
    expect(notConfigured.length).toBe(2); // LANDSCAPE and REELS
  });

  it("shows a plain 'not ready yet' message when the variant IS configured but no execution session has reached READY_TO_RENDER", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findByText("Not ready yet");
  });

  it("dispatches RENDER for a configured, ready variant with a real plain-language button label, and shows the real queued job id", async () => {
    const workerId = "44444444-4444-4444-4444-444444444444";
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [workerWithCapabilities(["RENDER"])] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: readyToRenderSession(workerId) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } },
      "/api/jobs": {
        status: 201,
        body: { jobId: "77777777-7777-7777-7777-777777777777", workerId, operation: "RENDER", status: "QUEUED", createdAt: new Date().toISOString() }
      }
    });
    renderTab();
    const renderButton = await screen.findByRole("button", { name: "Render Landscape" });
    await waitFor(() => expect((renderButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(renderButton);
    // Final MVP polish item 3 (client status copy): a plain confirmation,
    // never the raw job id (Advanced's Render Settings tab still shows the
    // id for operator correlation with the Jobs/Queue page - unaffected).
    //
    // 2026-10-04: "Started - this will update automatically" was followed by
    // nothing - the page never looked at the job again. The confirmation is
    // now a running notice with a clock that replaces the button until the
    // render ends, so it cannot be pressed a second time.
    const notice = (await screen.findByText("Your final Landscape video is being made…")).closest(".busy-notice") as HTMLElement;
    expect(notice.querySelector(".busy-notice__elapsed")).not.toBeNull();
    expect(notice.textContent).not.toContain("77777777-7777-7777-7777-777777777777");
    expect(screen.queryByRole("button", { name: "Render Landscape" })).toBeNull();
  });

  /**
   * 2026-10-04: a render that failed looked exactly like one that was never
   * started, and one that was running came back as a pressable button after
   * a reload.
   */
  describe("a render is watched from the press until it ends", () => {
    const workerId = "44444444-4444-4444-4444-444444444444";
    const JOB_ID = "77777777-7777-7777-7777-777777777777";
    const job = (status: string, error: { code: string; message: string } | null = null) => ({
      job: {
        jobId: JOB_ID,
        workerId,
        projectId: PROJECT_ID,
        operation: "RENDER",
        status,
        payload: { variant: "LANDSCAPE" },
        result: null,
        error,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        claimedAt: null,
        startedAt: null,
        completedAt: null,
        updatedAt: new Date().toISOString()
      }
    });
    const base = () => ({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [workerWithCapabilities(["RENDER"])] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: readyToRenderSession(workerId) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });

    it("a reload while it is rendering shows the same running state for THAT output, found in the job history - never the button", async () => {
      stubFetchByUrl({
        ...base(),
        "/api/jobs": {
          status: 200,
          body: {
            jobs: [
              {
                jobId: JOB_ID,
                operation: "RENDER",
                status: "RUNNING",
                workerId,
                workerName: "worker-a",
                projectId: PROJECT_ID,
                projectName: "Test Project",
                executionSessionId: null,
                error: null,
                createdAt: new Date(Date.now() - 65_000).toISOString(),
                completedAt: null,
                updatedAt: new Date().toISOString()
              }
            ]
          }
        },
        [`/api/jobs/${JOB_ID}`]: { status: 200, body: job("RUNNING") }
      });
      renderTab();

      const notice = (await screen.findByText("Your final Landscape video is being made…")).closest(".busy-notice") as HTMLElement;
      await waitFor(() => expect(notice.querySelector(".busy-notice__elapsed")?.textContent).toMatch(/^1:0\d$/));
      expect(screen.queryByRole("button", { name: "Render Landscape" })).toBeNull();
      // The other output is not claimed to be rendering.
      expect(screen.queryByText("Your final Reels video is being made…")).toBeNull();
    });

    it(
      "says it can take 30 to 40 minutes, and the finished video turns up as a download just below - without a reload",
      async () => {
        stubFetchByUrl({
          ...base(),
          "/api/jobs": { status: 201, body: { jobId: JOB_ID, workerId, operation: "RENDER", status: "QUEUED", createdAt: new Date().toISOString() } },
          [`/api/jobs/${JOB_ID}`]: { status: 200, body: job("SUCCEEDED") },
          // Nothing rendered when the page opens; the finished video once the job has succeeded.
          [`/api/projects/${PROJECT_ID}/render-artifacts`]: [
            { status: 200, body: { artifacts: [] } },
            { status: 200, body: { artifacts: [renderArtifactFixture()] } }
          ]
        });
        renderTab();
        const renderButton = await screen.findByRole("button", { name: "Render Landscape" });
        await waitFor(() => expect((renderButton as HTMLButtonElement).disabled).toBe(false));
        await screen.findByText("No renders yet");
        fireEvent.click(renderButton);

        const notice = (await screen.findByText("Your final Landscape video is being made…")).closest(".busy-notice") as HTMLElement;
        expect(notice.textContent).toContain("A final video can take 30 to 40 minutes.");

        const download = await screen.findByRole("link", { name: "Download" }, { timeout: 9_000 });
        expect(download.getAttribute("href")).toContain(`/api/projects/${PROJECT_ID}/render-artifacts/`);
        expect(screen.queryByText("No renders yet")).toBeNull();
        expect(screen.queryByText("Your final Landscape video is being made…")).toBeNull();
      },
      12_000
    );

    it(
      "a render that fails says so plainly, with the worker's own words behind Technical details, and gives the button back",
      async () => {
        const raw = "aerender exited with code 1: output module not found";
        stubFetchByUrl({
          ...base(),
          "/api/jobs": { status: 201, body: { jobId: JOB_ID, workerId, operation: "RENDER", status: "QUEUED", createdAt: new Date().toISOString() } },
          [`/api/jobs/${JOB_ID}`]: { status: 200, body: job("FAILED", { code: "INTERNAL_ERROR", message: raw }) }
        });
        renderTab();
        const renderButton = await screen.findByRole("button", { name: "Render Landscape" });
        await waitFor(() => expect((renderButton as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(renderButton);

        const alert = await screen.findByRole("alert", {}, { timeout: 9_000 });
        expect(alert.textContent).toContain("Your final Landscape video could not be made");
        expect(document.body.textContent).not.toContain("Could not dispatch this job");
        const details = alert.querySelector("details") as HTMLDetailsElement;
        expect(details.open).toBe(false);
        expect(details.querySelector("pre")?.textContent).toBe(raw);
        // The card no longer goes on saying "Started": the notice is gone and the way forward is named for what it does.
        expect(screen.queryByText("Your final Landscape video is being made…")).toBeNull();
        expect(screen.queryByText("Started - this will update automatically, no need to check again.")).toBeNull();
        screen.getByRole("button", { name: "Try again" });
      },
      12_000
    );
  });

  it("shows the real, downloadable Final Outputs list (the same authenticated artifact route Advanced's Render Settings tab uses)", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [renderArtifactFixture({ variant: "LANDSCAPE" })] } }
    });
    renderTab();
    const downloadLink = await screen.findByRole("link", { name: "Download" });
    expect(downloadLink.getAttribute("href")).toBe(`/api/projects/${PROJECT_ID}/render-artifacts/${renderArtifactFixture().id}/file`);
  });
});

/**
 * Live QA fix (CASE C, "Do not let users freely jump into a dead page"):
 * a Simple Mode client reaching this tab before any execution plan exists
 * must see an honest, actionable message with a way back to the guided
 * stepper - never the bare "No execution plan yet" dead end. Advanced Mode
 * keeps the raw technical empty state unchanged.
 */
describe("ProjectExportTab - locked before a plan exists (live QA fix)", () => {
  function stubNoPlan(): void {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 404, body: { error: { code: "EXECUTION_PLAN_NOT_FOUND", message: "none", requestId: "r1" } } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
  }

  it("Simple Mode shows an actionable locked notice with a return-to-current-step action, never 'No execution plan yet'", async () => {
    stubNoPlan();
    renderTab();

    await screen.findByText("Export isn't available yet");
    expect(screen.queryByText("No execution plan yet")).toBeNull();
    expect(screen.getByRole("link", { name: "Return to current step" })).not.toBeNull();
  });

  it("Advanced Mode keeps the raw technical empty state unchanged", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubNoPlan();
    renderTab();

    await screen.findByText("No execution plan yet");
  });
});

/**
 * REAL 2026-09-25 INCIDENT: the daily operator could not tell why the
 * Render button was greyed out. This tab's four disabling conditions are
 * genuinely different problems with genuinely different fixes - and the
 * most common one is fixable only on a tab Simple Mode does not even show -
 * so each must state itself ON the control, attached to it, not merely
 * somewhere else on the page.
 */
describe("ProjectExportTab - a disabled Render button always says why (REAL 2026-09-25 wayfinding incident)", () => {
  function renderButton(): HTMLButtonElement {
    return screen.getAllByRole("button", { name: /^Render / })[0] as HTMLButtonElement;
  }

  it("names the missing master composition AND the tab that fixes it, wired to the button itself", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ renderOutputs: { LANDSCAPE: null, REELS: null } }), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findAllByText("Not set up yet");

    const button = renderButton();
    expect(button.disabled).toBe(true);
    const reason = screen.getAllByText("This output has not been set up yet. Fill in the short setup form just below and press Save.")[0]!;
    expect(button.getAttribute("aria-describedby")).toBe(reason.getAttribute("id"));
  });

  it("switches to the final-preview reason once a master IS configured but no session is ready to render - never repeats the configuration reason", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findByText("Not ready yet");

    // The LANDSCAPE card is configured; its own button must give the
    // session reason, while REELS (still unconfigured) keeps its own.
    screen.getByText("The complete preview has to be approved on the Preview tab before rendering.");
    screen.getByText("This output has not been set up yet. Fill in the short setup form just below and press Save.");
  });

  it("reports a STALE master as a re-selection problem, never as 'not configured' - they need different fixes", async () => {
    stubFetchByUrl({
      ...NO_WORKERS_STATUS,
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: {
          plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig({ sourceProjectSha256: "e".repeat(64) }), REELS: null } }),
          sceneTable: []
        }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();
    await screen.findAllByText("Not set up yet");

    screen.getByText("The template changed since this output was set up. Set it up again in the form just below.");
  });

  it("an ENABLED Render button carries no reason at all - the explanation only ever appears when it is actually blocked", async () => {
    const worker = workerWithCapabilities(["RENDER"]);
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: null } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: readyToRenderSession(worker.workerId) } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
    renderTab();

    await waitFor(() => expect((screen.getAllByRole("button", { name: "Render Landscape" })[0] as HTMLButtonElement).disabled).toBe(false));
    const button = screen.getAllByRole("button", { name: "Render Landscape" })[0]!;
    expect(button.getAttribute("aria-describedby")).toBeNull();
    expect(button.getAttribute("title")).toBeNull();
  });
});

/**
 * 2026-10-04, seen live: the Reels card and a "Reels master" setup form were
 * drawn at full weight beside Landscape for a client with no interest in a
 * tall video, and the list of finished videos sat at the foot of the page
 * under both.
 */
describe("ProjectExportTab - Simple mode leads with the Landscape video", () => {
  // An earlier case in this file leaves this device in Advanced view; every case here starts from the Simple default.
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  function stubExport(reels: unknown): void {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: {
        status: 200,
        body: { plan: planFixture({ renderOutputs: { LANDSCAPE: landscapeConfig(), REELS: reels } }), sceneTable: [] }
      },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } }
    });
  }

  it("keeps the tall version behind a closed disclosure when none is set up - still there, one press away", async () => {
    stubExport(null);
    renderTab();

    const summary = await screen.findByText("Also make a tall version for phones");
    const disclosure = summary.closest("details") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    // The same card and the same setup form, inside it - nothing was removed.
    expect(disclosure.contains(screen.getByRole("button", { name: "Render Reels" }))).toBe(true);
    // The Landscape video is not inside it.
    expect(disclosure.contains(screen.getByRole("button", { name: "Render Landscape" }))).toBe(false);
  });

  it("puts the finished videos directly under the Landscape video, above the tall version", async () => {
    stubExport(null);
    renderTab();

    const disclosure = (await screen.findByText("Also make a tall version for phones")).closest("details") as HTMLElement;
    const landscape = screen.getByRole("button", { name: "Render Landscape" });
    const outputs = document.querySelector(".final-outputs-card") as HTMLElement;
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(landscape.compareDocumentPosition(outputs) & FOLLOWING).toBeTruthy();
    expect(outputs.compareDocumentPosition(disclosure) & FOLLOWING).toBeTruthy();
  });

  it("shows the tall version in the open once one IS set up - it is not hidden from someone who asked for it", async () => {
    stubExport(landscapeConfig({ manifestCompositionId: "comp-tall", compositionName: "Tall Master" }));
    renderTab();

    await screen.findByRole("button", { name: "Render Reels" });
    expect(screen.queryByText("Also make a tall version for phones")).toBeNull();
  });

  it("Advanced view is unchanged: both outputs in the open, finished videos at the foot", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubExport(null);
    renderTab();

    const reels = await screen.findByRole("button", { name: "Render Reels" });
    await waitFor(() => expect(screen.queryByText("Also make a tall version for phones")).toBeNull());
    const outputs = document.querySelector(".final-outputs-card") as HTMLElement;
    expect(reels.compareDocumentPosition(outputs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
