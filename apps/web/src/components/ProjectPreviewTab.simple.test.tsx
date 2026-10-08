// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectPreviewTab } from "./ProjectPreviewTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { ProjectGuidanceProvider } from "./ProjectGuidanceProvider";
import { ProjectNextActionBanner } from "./ProjectNextActionBanner";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { WorkspaceModeProvider } from "./WorkspaceModeProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, SOURCE_SHA, assetFixture, manifestFixture, planFixture, projectDtoFixture, sceneFixture } from "../test-utils/execution-plan-fixtures";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => `/projects/${PROJECT_ID}/preview`,
  useRouter: () => ({ push: routerPush })
}));

/**
 * The Preview tab as a NON-TECHNICAL CLIENT sees it (Simple mode, the
 * default). Raised by the owner on 2026-10-04 after walking it live: "the UX
 * is very complex, you can't tell where to click next". Each describe below is
 * one thing seen on screen that day.
 *
 * Every fixture here is made up and neutral - no real template's names, ids,
 * sizes or times.
 */

const SESSION_ID = "66666666-6666-6666-6666-666666666666";
const WORKER_ID = "44444444-4444-4444-4444-444444444444";
const JOB_ID = "55555555-5555-5555-5555-555555555555";
const WORKING_SHA = "d".repeat(64);
const SESSION_URL = `/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}`;
const SUGGESTION_URL = `/api/projects/${PROJECT_ID}/execution-plan/render-outputs/LANDSCAPE/suggestion`;
const RENDER_OUTPUT_URL = `/api/projects/${PROJECT_ID}/execution-plan/render-outputs/LANDSCAPE`;

type Reply = { status: number; body: unknown };
type Handler = Reply | Reply[];
interface Call {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Unlike stubFetchByUrl, keyed on METHOD + exact path: this tab now both
 * reads GET /api/jobs (the job history) and writes POST /api/jobs (a
 * dispatch), and those must not answer for each other. A list of replies is
 * served in order, the last one repeating.
 */
function stubApi(handlers: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: { method?: string; body?: string }) => {
      const url = (typeof input === "string" ? input : input.toString()).split("?")[0]!;
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const key = `${method} ${url}`;
      const handler = handlers[key];
      if (!handler) {
        return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
      }
      const replies = Array.isArray(handler) ? handler : [handler];
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      const reply = replies[Math.min(index, replies.length - 1)]!;
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: async () => JSON.stringify(reply.body), json: async () => reply.body };
    })
  );
  return calls;
}

function workerFixture(overrides: Record<string, unknown> = {}) {
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
    capabilities: ["EXECUTE_FRAME", "CREATE_PREVIEW"],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function sessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    executionPlanId: "plan-1",
    planRevision: 3,
    sourceProjectSha256: SOURCE_SHA,
    assignedWorkerId: WORKER_ID,
    status: "AWAITING_PREVIEW_APPROVAL",
    latestWorkingProjectSha256: WORKING_SHA,
    completedScenePlanIds: ["s1"],
    firstPreviewApproved: false,
    hasPreview: true,
    latestPreviewScenePlanId: "s1",
    latestPreviewCapturedAt: "2026-10-04T10:00:00.000Z",
    fullPreviewApproved: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

const approvedSession = (overrides: Record<string, unknown> = {}) => sessionFixture({ status: "READY_TO_RENDER", firstPreviewApproved: true, ...overrides });

function landscapeConfigFixture() {
  return {
    manifestCompositionId: "comp-whole",
    aeProjectItemIndex: 1,
    compositionName: "Whole Video",
    sourceProjectSha256: SOURCE_SHA,
    renderSettingsTemplateName: "Settings One",
    outputModuleTemplateName: "Module One",
    configuredAt: new Date().toISOString()
  };
}

function artifactFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "88888888-8888-8888-8888-888888888888",
    projectId: PROJECT_ID,
    executionSessionId: SESSION_ID,
    workingProjectSha256: WORKING_SHA,
    filename: "preview.mp4",
    mimeType: "video/mp4",
    byteSize: 100,
    capturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function jobFixture(operation: string, status: string, error: { code: string; message: string } | null = null) {
  return {
    job: {
      jobId: JOB_ID,
      workerId: WORKER_ID,
      projectId: PROJECT_ID,
      operation,
      status,
      payload: {},
      result: status === "SUCCEEDED" ? {} : null,
      error,
      checkpoint: null,
      createdAt: new Date().toISOString(),
      claimedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: status === "RUNNING" ? null : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

function historyRow(operation: string) {
  return {
    jobId: JOB_ID,
    operation,
    status: "RUNNING",
    workerId: WORKER_ID,
    workerName: "worker-a",
    projectId: PROJECT_ID,
    projectName: "Test Project",
    executionSessionId: SESSION_ID,
    error: null,
    createdAt: new Date(Date.now() - 75_000).toISOString(),
    completedAt: null,
    updatedAt: new Date().toISOString()
  };
}

const dispatched = (operation: string): Reply => ({
  status: 201,
  body: { jobId: JOB_ID, workerId: WORKER_ID, operation, status: "QUEUED", createdAt: new Date().toISOString() }
});

/** One approved, buildable scene; the given session; Landscape set up unless told otherwise. */
function baseHandlers(options: { session: unknown; landscape?: unknown; workers?: unknown[] }): Record<string, Handler> {
  const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
  const landscape = options.landscape === undefined ? landscapeConfigFixture() : options.landscape;
  return {
    "GET /api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: options.workers ?? [workerFixture()] } },
    [`GET /api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
    [`GET /api/projects/${PROJECT_ID}/execution-plan`]: {
      status: 200,
      body: { plan: planFixture({ status: "APPROVED", renderOutputs: { LANDSCAPE: landscape, REELS: null } }, scenes), sceneTable: [] }
    },
    [`GET /api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: options.session } },
    [`GET ${SESSION_URL}/full-preview-status`]: { status: 200, body: { artifact: null } },
    "GET /api/jobs": { status: 200, body: { jobs: [] } }
  };
}

function renderPreview(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <WorkspaceModeProvider>
        <ProjectWorkspaceProvider projectId={PROJECT_ID}>
          <ProjectPreviewTab />
        </ProjectWorkspaceProvider>
      </WorkspaceModeProvider>
    </DashboardStatusProvider>
  );
}

const dispatchesOf = (calls: Call[], operation: string): Call[] =>
  calls.filter((call) => call.method === "POST" && call.url === "/api/jobs" && (call.body as { operation?: string }).operation === operation);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  routerPush.mockReset();
  window.localStorage.clear();
});

describe("Simple Preview tab - the first frame asks one plain question", () => {
  it("shows the frame large, asks whether it looks right, and offers exactly yes and no", async () => {
    stubApi(baseHandlers({ session: sessionFixture() }));
    renderPreview();

    await screen.findByText("Does this frame look right?");
    const image = screen.getByAltText("Captured first-frame preview") as HTMLImageElement;
    // It was a thumbnail. Now it fills its card - and keeps the cache-busting
    // version (2026-09-09 incident), so a regenerated frame is really loaded.
    expect(image.className).toContain("first-frame__image");
    expect(image.src).toContain(`${SESSION_URL}/preview?v=`);

    screen.getByRole("button", { name: "Yes, make my full video" });
    screen.getByRole("button", { name: "No, something is wrong" });
    // The operator's wording stays in Advanced view.
    expect(screen.queryByRole("button", { name: "Approve preview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject preview" })).toBeNull();
  });

  it("shows nothing a client cannot act on: no engineering progress count, no status line, no started hint", async () => {
    stubApi(baseHandlers({ session: sessionFixture() }));
    renderPreview();

    await screen.findByText("Does this frame look right?");
    expect(screen.queryByText(/scenes completed/)).toBeNull();
    expect(screen.queryByText("All approved scenes have been executed - ready to render.")).toBeNull();
    expect(screen.queryByText("Scene execution")).toBeNull();
  });

  it('keeps "Preview at (seconds)" and "Regenerate First Preview" behind a closed "Look at a different moment" disclosure', async () => {
    stubApi(baseHandlers({ session: sessionFixture() }));
    renderPreview();

    const summary = await screen.findByText("Look at a different moment");
    const disclosure = summary.closest("details") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    // Still there for whoever opens it - nothing was removed.
    expect(disclosure.textContent).toContain("Preview at (seconds)");
    expect(disclosure.textContent).toContain("Regenerate First Preview");
    // And not at full weight beside the question.
    const questionCard = screen.getByText("Does this frame look right?").closest(".card, section, div.overview-section") as HTMLElement | null;
    expect(questionCard).not.toBeNull();
    const toolsOutsideDisclosure = Array.from(document.querySelectorAll('input[type="number"]')).filter((input) => !disclosure.contains(input));
    expect(toolsOutsideDisclosure).toHaveLength(0);
  });

  /**
   * Seen live: with one scene, "every scene is built" was already true while
   * the frame still waited for its answer, so a live "Create Complete Preview"
   * sat under it - and pressing it produced a red "The first-frame preview
   * for this execution session has not been approved yet".
   */
  it("does not offer the full video at all before the first frame is approved", async () => {
    const calls = stubApi(baseHandlers({ session: sessionFixture() }));
    renderPreview();

    await screen.findByText("Does this frame look right?");
    expect(screen.queryByRole("button", { name: "Make my full video" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create Complete Preview" })).toBeNull();
    expect(screen.queryByText("Step 2 - Your full video")).toBeNull();
    expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(0);
  });

  it("pressing yes IS the approval - the real approve call, made by that click - and then the full video starts by itself", async () => {
    const calls = stubApi({
      ...baseHandlers({ session: sessionFixture() }),
      [`POST ${SESSION_URL}/approve-preview`]: { status: 200, body: { session: approvedSession() } },
      "POST /api/jobs": dispatched("CREATE_PREVIEW"),
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("CREATE_PREVIEW", "RUNNING") }
    });
    renderPreview();

    // Nothing is approved or started by loading the page.
    const yes = await screen.findByRole("button", { name: "Yes, make my full video" });
    expect(calls.some((call) => call.url.endsWith("/approve-preview"))).toBe(false);

    fireEvent.click(yes);

    await screen.findByText("Your video is being made…");
    const approveIndex = calls.findIndex((call) => call.method === "POST" && call.url === `${SESSION_URL}/approve-preview`);
    const dispatchIndex = calls.findIndex((call) => call.method === "POST" && call.url === "/api/jobs");
    expect(approveIndex).toBeGreaterThanOrEqual(0);
    // Approval first; the server would refuse the other order.
    expect(dispatchIndex).toBeGreaterThan(approveIndex);
    expect(calls[dispatchIndex]!.body).toEqual({ operation: "CREATE_PREVIEW", workerId: WORKER_ID, projectId: PROJECT_ID, executionSessionId: SESSION_ID });
    expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(1);
    screen.getByText("You said this frame looks right.");
  });

  it("pressing no stops there, says so in plain words, and opens the way to try another moment or go back to Scenes", async () => {
    const calls = stubApi({
      ...baseHandlers({ session: sessionFixture() }),
      [`POST ${SESSION_URL}/reject-preview`]: { status: 200, body: { session: sessionFixture({ status: "FAILED" }) } }
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "No, something is wrong" }));

    await screen.findByText("This frame was not approved");
    expect(screen.getByRole("link", { name: "Go back to Scenes" }).getAttribute("href")).toBe(`/projects/${PROJECT_ID}/scenes`);
    expect((screen.getByText("Look at a different moment").closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(screen.queryByRole("button", { name: "Yes, make my full video" })).toBeNull();
    expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(0);
  });
});

describe("Simple Preview tab - making the full video says it is being made", () => {
  it("replaces the button with a running notice and a clock the moment it is pressed, so it cannot be pressed twice", async () => {
    const calls = stubApi({
      ...baseHandlers({ session: approvedSession() }),
      "POST /api/jobs": dispatched("CREATE_PREVIEW"),
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("CREATE_PREVIEW", "RUNNING") }
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Make my full video" }));

    const notice = (await screen.findByText("Your video is being made…")).closest(".busy-notice") as HTMLElement;
    expect(notice.querySelector(".busy-notice__elapsed")?.textContent).toMatch(/^\d+:\d\d$/);
    expect(notice.textContent).toContain("The video appears here by itself");
    expect(screen.queryByRole("button", { name: "Make my full video" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create Complete Preview" })).toBeNull();
    expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(1);
  });

  it("watches the job and shows the video by itself when it is ready", async () => {
    stubApi({
      ...baseHandlers({ session: approvedSession() }),
      "POST /api/jobs": dispatched("CREATE_PREVIEW"),
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("CREATE_PREVIEW", "SUCCEEDED") },
      // Nothing before the press; the finished video once the job has succeeded.
      [`GET ${SESSION_URL}/full-preview-status`]: [
        { status: 200, body: { artifact: null } },
        { status: 200, body: { artifact: artifactFixture() } }
      ]
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Make my full video" }));
    await screen.findByText("Your video is being made…");

    await waitFor(() => expect(document.querySelector("video")).not.toBeNull(), { timeout: 8_000 });
    expect(screen.queryByText("Your video is being made…")).toBeNull();
    screen.getByText("Watch your video from start to finish. Is it ready?");
    screen.getByRole("button", { name: "Approve Final Preview" });
  }, 12_000);

  /**
   * Seen live: nothing changed after the first press, so it was pressed
   * again, and the answer was a red "Worker <uuid> already has a live
   * CREATE_PREVIEW job in progress".
   */
  it('reads the server\'s "already has a live job" refusal as what it means - already being made - and never shows it as an error', async () => {
    const refusal = `Worker ${WORKER_ID} already has a live CREATE_PREVIEW job in progress`;
    stubApi({
      ...baseHandlers({ session: approvedSession() }),
      "POST /api/jobs": { status: 409, body: { error: { code: "WORKER_BUSY", message: refusal, requestId: "r1" } } }
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Make my full video" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Make my full video" })).toBeNull());
    screen.getByText("Your video is being made…");
    expect(document.body.textContent).not.toContain("already has a live");
    expect(document.body.textContent).not.toContain(WORKER_ID);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an editing computer busy with something ELSE is said in plain words, with the raw refusal kept behind Technical details", async () => {
    const refusal = `Worker ${WORKER_ID} is already at its concurrency limit`;
    stubApi({
      ...baseHandlers({ session: approvedSession() }),
      "POST /api/jobs": { status: 409, body: { error: { code: "WORKER_BUSY", message: refusal, requestId: "r1" } } }
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Make my full video" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The full video could not be started");
    expect(alert.textContent).toContain("Your editing computer is busy with another task right now.");
    const details = alert.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(refusal);
    // The way forward is the same button, named for what it does.
    screen.getByRole("button", { name: "Try again" });
  });

  it("a page reload while it is being made shows the same in-progress state, with the clock counting from when it really started", async () => {
    const calls = stubApi({
      ...baseHandlers({ session: approvedSession() }),
      "GET /api/jobs": { status: 200, body: { jobs: [historyRow("CREATE_PREVIEW")] } },
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("CREATE_PREVIEW", "RUNNING") }
    });
    renderPreview();

    const notice = (await screen.findByText("Your video is being made…")).closest(".busy-notice") as HTMLElement;
    // Started 75 seconds ago according to the job itself - not "0:00 since this page opened".
    await waitFor(() => expect(notice.querySelector(".busy-notice__elapsed")?.textContent).toMatch(/^1:1\d$/));
    expect(screen.queryByRole("button", { name: "Make my full video" })).toBeNull();
    // Nothing was pressed, so nothing was dispatched.
    expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(0);
  });

  it("a full video that fails while being made is said plainly, with the worker's own words behind Technical details and a Try again button", async () => {
    const raw = "operation 4 (RENDER_PREVIEW) failed: output module not found";
    stubApi({
      ...baseHandlers({ session: approvedSession() }),
      "POST /api/jobs": dispatched("CREATE_PREVIEW"),
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("CREATE_PREVIEW", "FAILED", { code: "INTERNAL_ERROR", message: raw }) }
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Make my full video" }));

    const alert = await screen.findByRole("alert", {}, { timeout: 8_000 });
    expect(alert.textContent).toContain("The full video could not be made");
    const details = alert.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("pre")?.textContent).toBe(raw);
    screen.getByRole("button", { name: "Try again" });
  }, 12_000);
});

/**
 * Seen live: "Landscape output is not configured ... configure it in Render
 * Settings" - which sent a client to an Advanced-only tab to type two After
 * Effects template names.
 */
describe("Simple Preview tab - the Landscape output is never a trip to another tab", () => {
  const suggestion = {
    manifestCompositionId: "comp-whole",
    compositionName: "Whole Video",
    renderSettingsTemplateName: "Settings One",
    outputModuleTemplateName: "Module One",
    basedOnProjectName: "Earlier Project"
  };

  it("with a suggestion: says in one plain line what will be used and where it came from, and changes nothing until the button is pressed", async () => {
    const calls = stubApi({
      ...baseHandlers({ session: approvedSession(), landscape: null }),
      [`GET ${SUGGESTION_URL}`]: { status: 200, body: { suggestion } }
    });
    renderPreview();

    await screen.findByText('The full video will be made from "Whole Video", with the same output settings as your project "Earlier Project".');
    screen.getByRole("button", { name: "Make my full video" });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    expect(document.body.textContent).not.toContain("Render Settings");
  });

  it("with a suggestion: the button saves it through the same render-output call the form uses, then starts the full video", async () => {
    const scenes = [sceneFixture({ id: "s1", approvalState: "APPROVED", unresolvedReasons: [] })];
    const calls = stubApi({
      ...baseHandlers({ session: approvedSession(), landscape: null }),
      [`GET ${SUGGESTION_URL}`]: { status: 200, body: { suggestion } },
      [`PUT ${RENDER_OUTPUT_URL}`]: {
        status: 200,
        body: { plan: planFixture({ status: "APPROVED", renderOutputs: { LANDSCAPE: landscapeConfigFixture(), REELS: null } }, scenes), sceneTable: [] }
      },
      "POST /api/jobs": dispatched("CREATE_PREVIEW"),
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("CREATE_PREVIEW", "RUNNING") }
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Make my full video" }));
    await waitFor(() => expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(1));

    const saveIndex = calls.findIndex((call) => call.method === "PUT" && call.url === RENDER_OUTPUT_URL);
    const dispatchIndex = calls.findIndex((call) => call.method === "POST" && call.url === "/api/jobs");
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(dispatchIndex).toBeGreaterThan(saveIndex);
    // Exactly what the server suggested - nothing typed, nothing invented here.
    expect(calls[saveIndex]!.body).toEqual({
      manifestCompositionId: "comp-whole",
      renderSettingsTemplateName: "Settings One",
      outputModuleTemplateName: "Module One"
    });
    screen.getByText("Your video is being made…");
  });

  it("with a suggestion that cannot be saved: nothing is dispatched, and the server's reason is shown", async () => {
    const calls = stubApi({
      ...baseHandlers({ session: approvedSession(), landscape: null }),
      [`GET ${SUGGESTION_URL}`]: { status: 200, body: { suggestion } },
      [`PUT ${RENDER_OUTPUT_URL}`]: { status: 409, body: { error: { code: "CONFLICT", message: "The template changed since this plan was made", requestId: "r1" } } }
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Make my full video" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The full video could not be started");
    expect(alert.textContent).toContain("The template changed since this plan was made");
    expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(0);
  });

  it("with NO suggestion: shows the setup form right here - never a pointer to another tab, and no button that could only be refused", async () => {
    const calls = stubApi({
      ...baseHandlers({ session: approvedSession(), landscape: null }),
      [`GET ${SUGGESTION_URL}`]: { status: 200, body: { suggestion: null } }
    });
    renderPreview();

    await screen.findByText("One thing is needed before the full video can be made");
    // The same form Export and Render Settings use.
    screen.getByLabelText("Master composition");
    screen.getByRole("button", { name: "Save" });
    expect(screen.queryByRole("button", { name: "Make my full video" })).toBeNull();
    expect(document.body.textContent).not.toContain("configure it in Render Settings");
    expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(0);
  });

  it("a suggestion that cannot be read falls back to the form - never a guess, never a dead end", async () => {
    stubApi(baseHandlers({ session: approvedSession(), landscape: null }));
    renderPreview();

    await screen.findByText("One thing is needed before the full video can be made");
    screen.getByLabelText("Master composition");
  });

  it("yes on the first frame with no suggestion approves, then stops at the form instead of dispatching something the server would refuse", async () => {
    const calls = stubApi({
      ...baseHandlers({ session: sessionFixture(), landscape: null }),
      [`GET ${SUGGESTION_URL}`]: { status: 200, body: { suggestion: null } },
      [`POST ${SESSION_URL}/approve-preview`]: { status: 200, body: { session: approvedSession() } }
    });
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: "Yes, make my full video" }));

    await screen.findByText("One thing is needed before the full video can be made");
    expect(dispatchesOf(calls, "CREATE_PREVIEW")).toHaveLength(0);
  });
});

/**
 * Seen live: a scene build failed inside After Effects and the page said
 * "Could not dispatch this job" - untrue, it was dispatched fine - over the
 * raw worker sentence, with a "Continue execution" button.
 */
describe("Simple Preview tab - building the video", () => {
  const notStarted = (): Record<string, Handler> => ({
    ...baseHandlers({ session: null }),
    [`POST /api/projects/${PROJECT_ID}/execution-sessions`]: {
      status: 201,
      body: { session: sessionFixture({ status: "PREPARING", latestWorkingProjectSha256: null, completedScenePlanIds: [], hasPreview: false, latestPreviewScenePlanId: null, latestPreviewCapturedAt: null }) }
    },
    "POST /api/jobs": dispatched("EXECUTE_FRAME")
  });

  it("says the video is being built, with a clock, from the press until the frame is there", async () => {
    stubApi({ ...notStarted(), [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("EXECUTE_FRAME", "RUNNING") } });
    renderPreview();

    const start = await screen.findByRole("button", { name: "Build my video" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);

    const notice = (await screen.findByText("Your video is being built…")).closest(".busy-notice") as HTMLElement;
    expect(notice.querySelector(".busy-notice__elapsed")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Build my video" })).toBeNull();
  });

  it("a build that fails says so truthfully and plainly, keeps the worker's sentence word for word behind Technical details, and offers Try again", async () => {
    const raw = "operation 2 (SET_TEXT) failed: the layer could not be found";
    stubApi({
      ...notStarted(),
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("EXECUTE_FRAME", "FAILED", { code: "INTERNAL_ERROR", message: raw }) }
    });
    renderPreview();

    const start = await screen.findByRole("button", { name: "Build my video" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);

    const alert = await screen.findByRole("alert", {}, { timeout: 6_000 });
    expect(alert.textContent).toContain("The video could not be built");
    // It WAS dispatched - saying otherwise was the untrue part.
    expect(document.body.textContent).not.toContain("Could not dispatch this job");
    const details = alert.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(alert.querySelector("summary")?.textContent).toBe("Technical details");
    expect(details.querySelector("pre")?.textContent).toBe(raw);

    screen.getByRole("button", { name: "Try again" });
    expect(screen.queryByRole("button", { name: "Continue execution" })).toBeNull();
  }, 10_000);

  it("a reload during a build finds the running job again instead of offering the button", async () => {
    stubApi({
      ...baseHandlers({ session: sessionFixture({ status: "PREPARING", latestWorkingProjectSha256: null, completedScenePlanIds: [], hasPreview: false, latestPreviewScenePlanId: null, latestPreviewCapturedAt: null }) }),
      "GET /api/jobs": { status: 200, body: { jobs: [historyRow("EXECUTE_FRAME")] } },
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("EXECUTE_FRAME", "RUNNING") }
    });
    renderPreview();

    await screen.findByText("Your video is being built…");
    expect(screen.queryByRole("button", { name: "Build my video" })).toBeNull();
  });

  // REAL 2026-10-07 (client project 3241977f): the build stopped inside After
  // Effects; after a reload the page showed a plain "Build my video" with no
  // word of it. The failed build is read back from the history.
  it("a reload after a failed build still says the build stopped, with the worker's words and Try again", async () => {
    const raw = "operation 52 (SET_TEXT) failed: TOOL_ERROR: [AE_TIMEOUT] Timed out after 30000ms waiting for After Effects";
    const failed = { ...historyRow("EXECUTE_FRAME"), status: "FAILED", error: { code: "NOT_AVAILABLE", message: raw }, completedAt: new Date(Date.now() - 60_000).toISOString() };
    stubApi({
      ...baseHandlers({ session: sessionFixture({ status: "PREPARING", latestWorkingProjectSha256: null, completedScenePlanIds: [], hasPreview: false, latestPreviewScenePlanId: null, latestPreviewCapturedAt: null }) }),
      "GET /api/jobs": { status: 200, body: { jobs: [failed] } }
    });
    renderPreview();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The video could not be built");
    expect(alert.querySelector("pre")?.textContent).toBe(raw);
    screen.getByRole("button", { name: "Try again" });
  });

  it("a failed build older than the frame on screen is not brought up again", async () => {
    const failed = { ...historyRow("EXECUTE_FRAME"), status: "FAILED", error: { code: "NOT_AVAILABLE", message: "old" }, completedAt: new Date(Date.now() - 3_600_000).toISOString() };
    stubApi({
      ...baseHandlers({ session: sessionFixture({ latestPreviewCapturedAt: new Date(Date.now() - 60_000).toISOString() }) }),
      "GET /api/jobs": { status: 200, body: { jobs: [failed] } }
    });
    renderPreview();

    await screen.findByText(/does this frame look right/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * Seen live: the banner still said "Create the first preview - Open the
 * Preview tab and press Start execution" with the finished first frame on
 * screen under it. The banner read the session once on page load; the tab
 * now tells it when the facts change.
 */
describe("Simple Preview tab - the banner above follows what happens on the tab", () => {
  it("moves from 'check the first frame' to 'being made' when yes is pressed, without a page reload", async () => {
    const awaiting = sessionFixture();
    const approved = approvedSession();
    stubApi({
      ...baseHandlers({ session: awaiting }),
      // The session as the server has it: awaiting until the approval lands.
      [`GET /api/projects/${PROJECT_ID}/execution-sessions/current`]: [
        { status: 200, body: { session: awaiting } },
        { status: 200, body: { session: awaiting } },
        { status: 200, body: { session: awaiting } },
        { status: 200, body: { session: approved } }
      ],
      [`GET /api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: null } },
      [`GET /api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } },
      [`GET /api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [assetFixture()] } },
      [`POST ${SESSION_URL}/approve-preview`]: { status: 200, body: { session: approved } },
      "POST /api/jobs": dispatched("CREATE_PREVIEW"),
      [`GET /api/jobs/${JOB_ID}`]: { status: 200, body: jobFixture("CREATE_PREVIEW", "RUNNING") },
      "GET /api/jobs": [
        { status: 200, body: { jobs: [] } },
        { status: 200, body: { jobs: [] } },
        { status: 200, body: { jobs: [] } },
        { status: 200, body: { jobs: [] } },
        { status: 200, body: { jobs: [historyRow("CREATE_PREVIEW")] } }
      ]
    });
    renderWithLocale(
      <DashboardStatusProvider>
        <WorkspaceModeProvider>
          <ProjectWorkspaceProvider projectId={PROJECT_ID}>
            <ProjectGuidanceProvider projectId={PROJECT_ID}>
              <ProjectNextActionBanner projectId={PROJECT_ID} />
              <ProjectPreviewTab />
            </ProjectGuidanceProvider>
          </ProjectWorkspaceProvider>
        </WorkspaceModeProvider>
      </DashboardStatusProvider>
    );
    const banner = (): string => document.querySelector(".next-action")?.textContent ?? "";

    await waitFor(() => expect(banner()).toContain("Check the first frame"));
    expect(banner()).not.toContain("Start execution");

    fireEvent.click(await screen.findByRole("button", { name: "Yes, make my full video" }));

    await waitFor(() => expect(banner()).toContain("Your full video is being made"), { timeout: 8_000 });
    expect(banner()).not.toContain("Check the first frame");
  }, 12_000);
});

/**
 * Seen live: after "Approve Final Preview" the Export tab kept its lock icon
 * and the banner did not move on until a hard reload, although the server
 * already had the session ready to render.
 */
describe("Simple Preview tab - approving the full video unlocks Export at once and goes there", () => {
  const exportTab = (): HTMLElement =>
    // 2026-10-07: while locked the tab is no link at all, so it is found by its name.
    Array.from(document.querySelectorAll(".workspace-tabs .workspace-tab")).find((tab) => (tab.textContent ?? "").trim().startsWith("Export")) as HTMLElement;

  function stubApproval(approveReply: Reply): void {
    const ready = approvedSession();
    const approved = approvedSession({ fullPreviewApproved: true });
    stubApi({
      ...baseHandlers({ session: ready }),
      [`GET ${SESSION_URL}/full-preview-status`]: { status: 200, body: { artifact: artifactFixture() } },
      [`GET /api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: null } },
      [`GET /api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } },
      [`GET /api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [assetFixture()] } },
      [`POST ${SESSION_URL}/approve-final-preview`]: approveReply,
      // What the server holds: approved only once the approval call has been answered.
      [`GET /api/projects/${PROJECT_ID}/execution-sessions/current`]: {
        status: 200,
        get body() {
          return { session: approvalLanded ? approved : ready };
        }
      } as Reply
    });
  }
  let approvalLanded = false;

  function renderInShell(): void {
    renderWithLocale(
      <DashboardStatusProvider>
        <WorkspaceModeProvider>
          <ProjectWorkspaceProvider projectId={PROJECT_ID}>
            <ProjectGuidanceProvider projectId={PROJECT_ID}>
              <ProjectWorkspaceShell projectId={PROJECT_ID}>
                <ProjectPreviewTab />
              </ProjectWorkspaceShell>
            </ProjectGuidanceProvider>
          </ProjectWorkspaceProvider>
        </WorkspaceModeProvider>
      </DashboardStatusProvider>
    );
  }

  it("the lock comes off the Export tab, the banner moves on, and the person is taken to Export - without a reload", async () => {
    approvalLanded = false;
    stubApproval({
      status: 200,
      get body() {
        approvalLanded = true;
        return { session: approvedSession({ fullPreviewApproved: true }) };
      }
    } as Reply);
    renderInShell();

    const approve = await screen.findByRole("button", { name: "Approve Final Preview" });
    await waitFor(() => expect(exportTab().getAttribute("data-locked")).toBe("true"));
    const banner = (): string => document.querySelector(".next-action")?.textContent ?? "";
    await waitFor(() => expect(banner()).toContain("Watch and approve the full video"));
    expect(routerPush).not.toHaveBeenCalled();

    fireEvent.click(approve);

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/export`));
    await waitFor(() => expect(exportTab().getAttribute("data-locked")).toBeNull());
    await waitFor(() => expect(banner()).toContain("Render the final video"));
    expect(banner()).not.toContain("Watch and approve the full video");
  });

  it("a refused approval goes nowhere and unlocks nothing", async () => {
    approvalLanded = false;
    stubApproval({ status: 409, body: { error: { code: "PRECONDITION_NOT_MET", message: "The complete preview is out of date", requestId: "r1" } } });
    renderInShell();

    fireEvent.click(await screen.findByRole("button", { name: "Approve Final Preview" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That did not go through");
    expect(routerPush).not.toHaveBeenCalled();
    expect(exportTab().getAttribute("data-locked")).toBe("true");
  });
});
