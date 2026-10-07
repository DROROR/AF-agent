// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import { ProjectGuidanceProvider } from "./ProjectGuidanceProvider";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { WorkspaceModeProvider } from "./WorkspaceModeProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, SOURCE_SHA, assetFixture, manifestFixture, planFixture, projectDtoFixture, renderArtifactFixture, sceneFixture, stubFetchByUrl, workMapEntryFixture, workMapFixture } from "../test-utils/execution-plan-fixtures";

/**
 * REAL 2026-09-25 INCIDENT: the person who uses this dashboard every day
 * said the UX was very bad because they could not tell which step to do
 * when - which tab to open, which button to press next, or why a button was
 * disabled - and had to be talked through every single click.
 *
 * These tests cover the three things the fix promises, and only real
 * promises: the banner names the genuinely-next action and where it lives,
 * a gated tab says what unlocks it, and when the real state cannot be read
 * the UI says so instead of naming a step it has not confirmed.
 */

/**
 * These cases render a NON-front page (Files) by default. As of the
 * 2026-09-26 subtraction pass the banner is the "what to do next" voice on
 * every page EXCEPT the project's front page, where ProjectChecklist owns
 * that job and says the same thing in a fuller form - two voices on one
 * screen being the operator's actual complaint ("upar kuch hai neeche kuch
 * hai"). The front page's own behaviour is pinned separately, below.
 */
let currentPathname = `/projects/${PROJECT_ID}/assets`;
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: vi.fn() })
}));

beforeEach(() => {
  currentPathname = `/projects/${PROJECT_ID}/assets`;
  // renderWithLocale sets <html lang> and never restores it, so one Hebrew
  // case would otherwise make every later case in this file render Hebrew.
  document.documentElement.setAttribute("lang", "en");
  // One case below switches this device to Advanced view; every other case is the Simple default.
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    projectId: PROJECT_ID,
    executionPlanId: "plan-1",
    planRevision: 1,
    sourceProjectSha256: SOURCE_SHA,
    status: "PREPARING",
    assignedWorkerId: "11111111-1111-1111-1111-111111111111",
    latestWorkingProjectSha256: null,
    completedScenePlanIds: [],
    firstPreviewApproved: false,
    hasPreview: false,
    latestPreviewScenePlanId: null,
    latestPreviewCapturedAt: null,
    fullPreviewApproved: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

const SESSION_ID = "22222222-2222-2222-2222-222222222222";
const WORKING_SHA = "d".repeat(64);

/** One live row of the caller's own job history - the same list the Jobs page shows. */
function liveJobFixture(operation: "EXECUTE_FRAME" | "CREATE_PREVIEW") {
  return {
    jobId: "33333333-3333-3333-3333-333333333333",
    operation,
    status: "RUNNING",
    workerId: "11111111-1111-1111-1111-111111111111",
    workerName: "worker-a",
    projectId: PROJECT_ID,
    projectName: "Test Project",
    executionSessionId: SESSION_ID,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    updatedAt: new Date().toISOString()
  };
}

function fullPreviewArtifactFixture() {
  return {
    id: "88888888-8888-8888-8888-888888888888",
    projectId: PROJECT_ID,
    executionSessionId: SESSION_ID,
    workingProjectSha256: WORKING_SHA,
    filename: "preview.mp4",
    mimeType: "video/mp4",
    byteSize: 100,
    capturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
}

function renderOutputFixture(overrides: Record<string, unknown> = {}) {
  return {
    manifestCompositionId: "c1",
    aeProjectItemIndex: 1,
    compositionName: "Scene 01",
    sourceProjectSha256: SOURCE_SHA,
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Render Settings",
    configuredAt: new Date().toISOString(),
    ...overrides
  };
}

/** Every URL the workspace + guidance really fetch, so nothing 404s into an accidental "unknown". */
function stubAll(overrides: Record<string, Parameters<typeof stubFetchByUrl>[0][string]> = {}): void {
  stubFetchByUrl({
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } },
    [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
    [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } },
    // ProjectGuidanceProvider reads the Asset Catalog too (2026-10-02): with
    // no files the next action is "upload the client's files", and an
    // unstubbed fetch reads as "not known yet", not as zero.
    [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [assetFixture()] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
    ...overrides
  });
}

function renderShell(locale?: "en" | "he"): void {
  renderWithLocale(
    <WorkspaceModeProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectGuidanceProvider projectId={PROJECT_ID}>
          <ProjectWorkspaceShell projectId={PROJECT_ID}>
            <div>tab content</div>
          </ProjectWorkspaceShell>
        </ProjectGuidanceProvider>
      </ProjectWorkspaceProvider>
    </WorkspaceModeProvider>,
    locale ? { locale } : undefined
  );
}

function banner(): HTMLElement {
  const element = document.querySelector(".next-action");
  if (!element) {
    throw new Error("next-action banner not found");
  }
  return element as HTMLElement;
}

function tabLink(label: string): HTMLElement {
  const nav = document.querySelector(".workspace-tabs");
  if (!nav) {
    throw new Error("workspace-tabs nav not found");
  }
  return within(nav as HTMLElement).getByRole("link", { name: new RegExp(`^${label}`) });
}

/** A fully-executed project: plan approved, one executable scene, first preview approved, that scene built. */
function executedProjectStubs(overrides: { renderOutputs?: Record<string, unknown>; sessionOverrides?: Record<string, unknown> } = {}) {
  const scene = sceneFixture({ id: "scene-1", use: true, approvalState: "APPROVED", unresolvedReasons: [] });
  return {
    [`/api/projects/${PROJECT_ID}/execution-plan`]: {
      status: 200,
      body: {
        plan: planFixture({ status: "APPROVED", renderOutputs: overrides.renderOutputs ?? { LANDSCAPE: null, REELS: null } }, [scene]),
        sceneTable: []
      }
    },
    [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: {
      status: 200,
      body: {
        session: sessionFixture({
          status: "READY_TO_RENDER",
          firstPreviewApproved: true,
          completedScenePlanIds: ["scene-1"],
          ...overrides.sessionOverrides
        })
      }
    }
  } as Record<string, Parameters<typeof stubFetchByUrl>[0][string]>;
}

describe("Project wayfinding - the 'what to do next' banner", () => {
  it("names the real next action, the real button, and links to the tab that holds it", async () => {
    // A created-but-unapproved plan whose only scene still has an
    // unresolved reason: the honest instruction is "go review the scenes".
    stubAll();
    renderShell();
    await screen.findByText("Review each scene");

    const link = within(banner()).getByRole("link", { name: "Go to Scenes" });
    expect(link.getAttribute("href")).toBe(`/projects/${PROJECT_ID}/scenes`);
    // It names the actual control, not just the phase.
    expect(banner().textContent).toContain("Approve Scenes");
  });

  it("says 'you are on the right tab' instead of a link when the action lives on the page you are already looking at", async () => {
    currentPathname = `/projects/${PROJECT_ID}/scenes`;
    // 2026-10-07: in Simple view the Scenes tab's own guide says this, and the banner stands down there - so this is the Advanced view's banner.
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubAll();
    renderShell();
    await screen.findByText("Review each scene");

    expect(within(banner()).queryByRole("link")).toBeNull();
    within(banner()).getByText("You are on the right tab");
  });

  it("THE DEAD END, CLOSED (Advanced view): a fully-executed project with no Landscape master is sent to Export - a tab that is always in the nav and holds the fix", async () => {
    // This is exactly where the operator got stuck: every scene built, the
    // Export button permanently greyed out, and the only instruction in the
    // whole product was to switch to Advanced view and find a tab the nav
    // does not list. The setup form now lives on Export itself
    // (ProjectExportTab -> VariantConfigCard), so the instruction is an
    // action on a tab they can already see.
    //
    // 2026-10-04: this pointer is now Advanced-only - see the next test for
    // what Simple mode says instead.
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubAll(executedProjectStubs());
    renderShell();
    await screen.findByText("Choose which part of the template is your finished video");

    const link = within(banner()).getByRole("link", { name: "Go to Export" });
    expect(link.getAttribute("href")).toBe(`/projects/${PROJECT_ID}/export`);
    // It must never again send anyone to another view to unblock this.
    expect(banner().textContent).not.toContain("Advanced");
    expect(banner().textContent).not.toContain("Render Settings");
  });

  /**
   * 2026-10-04: a client pressed "Create Complete Preview" and was told to go
   * and configure the Landscape output on another tab. In Simple mode the
   * Preview tab now does that itself (or shows the form in place), so the
   * banner keeps them on the one path: Preview, make the full video.
   */
  it("Simple mode: the same project is sent to Preview to make the full video - the missing Landscape setup is handled there, not on another tab", async () => {
    stubAll(executedProjectStubs());
    renderShell();
    await screen.findByText("Make the full video");

    expect(within(banner()).getByRole("link", { name: "Go to Preview" }).getAttribute("href")).toBe(`/projects/${PROJECT_ID}/preview`);
    expect(banner().textContent).not.toContain("Choose which part of the template");
    expect(banner().textContent).not.toContain("Render Settings");
  });

  it("asks for the full video to be made once everything is built, and for it to be watched only once there is one", async () => {
    stubAll(executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }));
    renderShell();
    await screen.findByText("Make the full video");
    expect(within(banner()).getByRole("link", { name: "Go to Preview" }).getAttribute("href")).toBe(`/projects/${PROJECT_ID}/preview`);

    cleanup();
    stubAll({
      ...executedProjectStubs({
        renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null },
        sessionOverrides: { latestWorkingProjectSha256: WORKING_SHA }
      }),
      [`/api/projects/${PROJECT_ID}/execution-sessions/${SESSION_ID}/full-preview-status`]: {
        status: 200,
        body: { artifact: fullPreviewArtifactFixture() }
      }
    });
    renderShell();
    await screen.findByText("Watch and approve the full video");
  });

  /**
   * 2026-10-04, seen live: the banner said "Create the first preview - press
   * Start execution" while the video was being built, and went on saying it
   * with the finished first frame on screen. Each of these is a different
   * real state and gets its own words.
   */
  it("follows the build and the complete preview while they run - a wait is named as a wait", async () => {
    // A scene is being built, no frame yet.
    stubAll({
      ...executedProjectStubs({ sessionOverrides: { status: "PREPARING", firstPreviewApproved: false, completedScenePlanIds: [] } }),
      "/api/jobs": { status: 200, body: { jobs: [liveJobFixture("EXECUTE_FRAME")] } }
    });
    renderShell();
    await screen.findByText("Your video is being built");
    expect(banner().textContent).not.toContain("Create the first preview");

    // The frame is there and waiting for its answer.
    cleanup();
    stubAll(executedProjectStubs({ sessionOverrides: { status: "AWAITING_PREVIEW_APPROVAL", firstPreviewApproved: false } }));
    renderShell();
    await screen.findByText("Check the first frame");

    // The complete preview is being made.
    cleanup();
    stubAll({
      ...executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }),
      "/api/jobs": { status: 200, body: { jobs: [liveJobFixture("CREATE_PREVIEW")] } }
    });
    renderShell();
    await screen.findByText("Your full video is being made");
    expect(within(banner()).getByRole("link", { name: "Go to Preview" })).not.toBeNull();
  });

  it("a job history that cannot be read never blanks the banner - it falls back to the step that is true without it", async () => {
    stubAll({
      ...executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }),
      "/api/jobs": { status: 500, body: { error: { code: "INTERNAL", message: "boom", requestId: "r1" } } }
    });
    renderShell();
    await screen.findByText("Make the full video");
  });

  it("treats a Landscape master configured against an OLDER template as not configured - never offers a render that cannot run", async () => {
    stubAll(
      executedProjectStubs({
        renderOutputs: { LANDSCAPE: renderOutputFixture({ sourceProjectSha256: "b".repeat(64) }), REELS: null },
        sessionOverrides: { fullPreviewApproved: true }
      })
    );
    renderShell();
    // Despite the complete preview already being approved, the blocking
    // fact is the stale master - so that is what it says.
    await screen.findByText("Choose which part of the template is your finished video");
  });

  it("reaches Export only after the real fullPreviewApproved gate, and reports 'done' once a render artifact exists", async () => {
    stubAll(
      executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null }, sessionOverrides: { fullPreviewApproved: true } })
    );
    renderShell();
    await screen.findByText("Render the final video");
    expect(within(banner()).getByRole("link", { name: "Go to Export" }).getAttribute("href")).toBe(`/projects/${PROJECT_ID}/export`);

    cleanup();
    stubAll({
      ...executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null }, sessionOverrides: { fullPreviewApproved: true } }),
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [renderArtifactFixture()] } }
    });
    renderShell();
    await screen.findByText("Everything is done");
  });

  it("renders the whole banner in Hebrew, with no English leaking through", async () => {
    stubAll(executedProjectStubs());
    renderShell("he");
    await screen.findByText("יצירת הווידאו המלא");

    within(banner()).getByText("מה לעשות עכשיו");
    within(banner()).getByRole("link", { name: "מעבר לתצוגה מקדימה" });
    // The one phrase the English copy would have produced here.
    expect(banner().textContent).not.toContain("Make the full video");
  });
});

/**
 * `projectWorkspace.tabLockedHint` had been sitting in BOTH locale
 * dictionaries since it was written with nothing rendering it - so "locked
 * until mappings are approved" was a promise the UI never actually kept.
 */
describe("Project wayfinding - locked tabs say what unlocks them", () => {
  it("shows the real locked hint for Preview and Export, wired to the tab with aria-describedby", async () => {
    stubAll();
    renderShell();
    await screen.findByText("Review each scene");

    const previewHint = screen.getByText("Locked until mappings are approved");
    expect(tabLink("Preview").getAttribute("aria-describedby")).toBe(previewHint.getAttribute("id"));
    expect(tabLink("Preview").getAttribute("data-locked")).toBe("true");

    const exportHint = screen.getByText("Locked until Final Preview is approved");
    expect(tabLink("Export").getAttribute("aria-describedby")).toBe(exportHint.getAttribute("id"));
  });

  it("stops calling Preview locked once the plan is approved with a genuinely executable scene, while Export stays locked on the real final-preview gate", async () => {
    stubAll(executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }));
    renderShell();
    await screen.findByText("Make the full video");

    expect(tabLink("Preview").getAttribute("data-locked")).toBeNull();
    expect(screen.queryByText("Locked until mappings are approved")).toBeNull();
    // Every scene is built and the master is configured, but the human has
    // not approved the complete preview - the exact gate the server enforces.
    expect(tabLink("Export").getAttribute("data-locked")).toBe("true");
    screen.getByText("Locked until Final Preview is approved");
  });

  /**
   * 2026-09-26: the tab bar used to draw its own "Next" badge as well. Three
   * elements then answered "where do I go" at once - stepper, banner, tab
   * badge - and the operator had to read and reconcile all three before
   * acting. The badge went; the lock hints stayed, because "why can I not
   * use this tab" is a different question nothing else on screen answers.
   */
  it("the tab bar no longer marks the next step itself - the banner alone names the tab and links to it", async () => {
    stubAll(executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }));
    renderShell();
    await screen.findByText("Make the full video");

    const nav = document.querySelector(".workspace-tabs") as HTMLElement;
    expect(nav.querySelectorAll('[data-next="true"]')).toHaveLength(0);
    expect(nav.textContent).not.toContain("Next");
    // The one remaining pointer still points at the real place.
    expect(within(banner()).getByRole("link").getAttribute("href")).toBe(`/projects/${PROJECT_ID}/preview`);
  });
});

/**
 * The hard requirement behind all of this: "Never invent state. If the UI
 * cannot tell what step the project is on, it must say so rather than
 * guess." A failed status fetch used to arrive as the same `null` an absent
 * session produces, so a broken API rendered as "this project has not
 * started yet" - a confident, wrong instruction.
 */
describe("Project wayfinding - never invents state", () => {
  it("says it cannot tell (and names no step, no next action and no lock) when the real status cannot be loaded", async () => {
    stubAll({
      // Only the session call fails. Everything else succeeds, so any
      // remaining "best guess" behaviour would still have plenty to chew on.
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: {
        status: 500,
        body: { error: { code: "INTERNAL", message: "boom", requestId: "r1" } }
      }
    });
    renderShell();
    await screen.findByText("We cannot tell which step this project is on");

    // No fabricated step, no fabricated instruction, no fabricated lock.
    expect(screen.queryByText(/^Step \d of 7/)).toBeNull();
    expect(screen.queryByText("Review each scene")).toBeNull();
    expect(screen.queryByText("Locked until mappings are approved")).toBeNull();
    expect(document.querySelector('.workspace-tabs [data-next="true"]')).toBeNull();
    expect(document.querySelector('.workspace-tabs [data-locked="true"]')).toBeNull();
    // Navigation itself is never taken away - every tab is still reachable.
    expect(within(document.querySelector(".workspace-tabs") as HTMLElement).getAllByRole("link")).toHaveLength(6);
  });

  it("the seven-chip stepper is gone from every page's chrome - it named a phase, never an action, and doubled the banner", async () => {
    stubAll(executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }));
    renderShell();
    await waitFor(() => expect(banner().textContent).toContain("Make the full video"));

    expect(document.querySelector(".workflow-stepper")).toBeNull();
    expect(screen.queryByText(/^Step \d of 7/)).toBeNull();
  });
});

/**
 * SUBTRACTION PASS (2026-09-26). The operator's complaint after the first
 * round of wayfinding work was about volume, not accuracy: "bahut complex
 * hai, samajh nahi aa raha" (too complex, I cannot follow it), and then,
 * precisely, "upar kuch hai neeche kuch hai" - something up top, something
 * else below. Six layers of chrome stacked above any content, three of them
 * answering the same question.
 *
 * These cases hold the cut in place. Each one would pass again the moment
 * someone re-adds the thing it names, which is the point.
 */
describe("Project workspace - what was taken off the page", () => {
  it("the project's front page has exactly ONE 'what to do next' voice: the checklist, never the checklist AND the banner", async () => {
    currentPathname = `/projects/${PROJECT_ID}`;
    stubAll();
    renderShell();
    await screen.findByText("White App Promo");

    expect(document.querySelector(".next-action")).toBeNull();
    // ...and it is still present on every other page, where nothing else
    // carries the answer.
    cleanup();
    currentPathname = `/projects/${PROJECT_ID}/assets`;
    stubAll();
    renderShell();
    await screen.findByText("Review each scene");
    expect(document.querySelector(".next-action")).not.toBeNull();
  });

  it("keeps the technical facts, the Advanced switch and Delete Project at the top, where the operator asked for them", async () => {
    stubAll();
    renderShell();
    await screen.findByText("White App Promo");

    // The facts stay in a closed disclosure: one line of chrome, and no hunt
    // when support asks which template and revision this is.
    const header = document.querySelector(".workspace-header__details") as HTMLElement;
    expect(header).not.toBeNull();
    expect((header as HTMLDetailsElement).open).toBe(false);
    expect(header.textContent).toContain("Source SHA");

    // The switch and Delete sit in the header actions, as they always did.
    const actions = document.querySelector(".workspace-header__actions") as HTMLElement;
    within(actions).getByRole("button", { name: "Advanced" });
    within(actions).getByRole("button", { name: "Simple" });
    within(actions).getByRole("button", { name: "Delete Project" });
  });

  it("still asks before deleting - the confirmation is what guards a destructive button at the top of every page", async () => {
    stubAll();
    renderShell();
    await screen.findByText("White App Promo");

    const actions = document.querySelector(".workspace-header__actions") as HTMLElement;
    fireEvent.click(within(actions).getByRole("button", { name: "Delete Project" }));
    // Nothing is deleted on the first click; a dialog asks first.
    await screen.findByText(/Delete this project/i);
  });

  it("the Advanced switch still works from the header, and reveals the two technical tabs - hidden, never deleted", async () => {
    stubAll();
    renderShell();
    await screen.findByText("White App Promo");

    const nav = document.querySelector(".workspace-tabs") as HTMLElement;
    expect(within(nav).getAllByRole("link")).toHaveLength(6);

    fireEvent.click(within(document.querySelector(".workspace-header__actions") as HTMLElement).getByRole("button", { name: "Advanced" }));

    expect(
      within(document.querySelector(".workspace-tabs") as HTMLElement)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["Project", "Files", "AI Plan", "Scenes", "Preview", "Export", "Render Settings", "Revisions"]);
  });
});
