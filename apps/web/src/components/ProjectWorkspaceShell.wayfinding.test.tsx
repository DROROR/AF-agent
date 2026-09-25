// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import { ProjectGuidanceProvider } from "./ProjectGuidanceProvider";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { WorkspaceModeProvider } from "./WorkspaceModeProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, SOURCE_SHA, manifestFixture, planFixture, projectDtoFixture, renderArtifactFixture, sceneFixture, stubFetchByUrl, workMapEntryFixture, workMapFixture } from "../test-utils/execution-plan-fixtures";

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

let currentPathname = `/projects/${PROJECT_ID}`;
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: vi.fn() })
}));

beforeEach(() => {
  currentPathname = `/projects/${PROJECT_ID}`;
  // renderWithLocale sets <html lang> and never restores it, so one Hebrew
  // case would otherwise make every later case in this file render Hebrew.
  document.documentElement.setAttribute("lang", "en");
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
    stubAll();
    renderShell();
    await screen.findByText("Review each scene");

    expect(within(banner()).queryByRole("link")).toBeNull();
    within(banner()).getByText("You are on the right tab");
  });

  it("THE STEP NOTHING USED TO POINT AT: a fully-executed project with no Landscape master is sent to Render Settings, and told it lives in Advanced view", async () => {
    // This is exactly where the operator got stuck: every scene built, the
    // Export button permanently greyed out, and in Simple Mode the tab that
    // fixes it is not even in the nav.
    stubAll(executedProjectStubs());
    renderShell();
    await screen.findByText("Choose the Landscape master");

    const link = within(banner()).getByRole("link", { name: "Go to Render Settings" });
    expect(link.getAttribute("href")).toBe(`/projects/${PROJECT_ID}/render-settings`);
    expect(banner().textContent).toContain("Advanced");
  });

  it("moves on to the complete preview only once the Landscape master really is configured against the current template", async () => {
    stubAll(executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }));
    renderShell();
    await screen.findByText("Review the complete video");
    expect(within(banner()).getByRole("link", { name: "Go to Preview" }).getAttribute("href")).toBe(`/projects/${PROJECT_ID}/preview`);
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
    await screen.findByText("Choose the Landscape master");
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
    await screen.findByText("בחירת קומפוזיציית המאסטר ללנדסקייפ");

    within(banner()).getByText("מה לעשות עכשיו");
    within(banner()).getByRole("link", { name: "מעבר להגדרות רינדור" });
    // The one phrase the English copy would have produced here.
    expect(banner().textContent).not.toContain("Choose the Landscape master");
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
    await screen.findByText("Review the complete video");

    expect(tabLink("Preview").getAttribute("data-locked")).toBeNull();
    expect(screen.queryByText("Locked until mappings are approved")).toBeNull();
    // Every scene is built and the master is configured, but the human has
    // not approved the complete preview - the exact gate the server enforces.
    expect(tabLink("Export").getAttribute("data-locked")).toBe("true");
    screen.getByText("Locked until Final Preview is approved");
  });

  it("marks exactly one tab as the next step, and marks it on the tab the banner links to", async () => {
    stubAll(executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }));
    renderShell();
    await screen.findByText("Review the complete video");

    const nav = document.querySelector(".workspace-tabs") as HTMLElement;
    const marked = Array.from(nav.querySelectorAll('[data-next="true"]'));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.getAttribute("href")).toBe(`/projects/${PROJECT_ID}/preview`);
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
    expect(within(document.querySelector(".workspace-tabs") as HTMLElement).getAllByRole("link")).toHaveLength(5);
  });

  it("the stepper and the banner never contradict each other - both come from the one shared derivation", async () => {
    stubAll(executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }));
    renderShell();

    // Step 6 of 7 is "Final Preview"; the banner's action for that same
    // state is reviewing the complete video, on the Preview tab.
    await screen.findByText("Step 6 of 7 — Final Preview");
    await waitFor(() => expect(banner().textContent).toContain("Review the complete video"));
  });
});
