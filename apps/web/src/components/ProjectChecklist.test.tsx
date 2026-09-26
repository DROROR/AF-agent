// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectChecklist } from "./ProjectChecklist";
import { ProjectGuidanceProvider } from "./ProjectGuidanceProvider";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  SOURCE_SHA,
  manifestFixture,
  planFixture,
  projectDtoFixture,
  renderArtifactFixture,
  sceneFixture,
  stubFetchByUrl,
  workMapEntryFixture,
  workMapFixture
} from "../test-utils/execution-plan-fixtures";

/**
 * The project's front page after the 2026-09-26 subtraction pass.
 *
 * The operator who runs this dashboard every day said, after a first round
 * of wayfinding work had already shipped, that it was still too complex to
 * follow - "steppers theek nahi... upar kuch hai neeche kuch hai" (the
 * steppers are not right; something up top, something else below). Three
 * elements were answering "where am I and what now" simultaneously and none
 * of them contained the actual next move.
 *
 * What these tests hold in place is therefore not decoration: the list is
 * derived, never guessed; exactly one row is live and it carries the real
 * action and a real link; and when the project's status genuinely cannot be
 * read, NOTHING is shown rather than a confident wrong step.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => `/projects/${PROJECT_ID}`,
  useRouter: () => ({ push: vi.fn() })
}));

beforeEach(() => {
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

function renderChecklist(locale?: "en" | "he"): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectGuidanceProvider projectId={PROJECT_ID}>
        <ProjectChecklist projectId={PROJECT_ID} />
      </ProjectGuidanceProvider>
    </ProjectWorkspaceProvider>,
    locale ? { locale } : undefined
  );
}

function list(): HTMLElement {
  const element = document.querySelector(".project-checklist");
  if (!element) {
    throw new Error("project-checklist not found");
  }
  return element as HTMLElement;
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

describe("ProjectChecklist - one list, one live row", () => {
  it("shows every step in order with its real state, and opens exactly one of them", async () => {
    stubAll();
    renderChecklist();
    await screen.findByText("Your video, step by step");

    const items = list().querySelectorAll(".project-checklist__item");
    expect(items).toHaveLength(7);

    // A plan exists (planFixture) but its only scene is unresolved, so the
    // real state is: uploaded, planned, plan created - now review scenes.
    const current = list().querySelectorAll('[data-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Match Your Content");

    // Only the open row is clickable. Six rows of links were six more
    // places to guess at, which is what the old stepper offered.
    expect(within(list()).getAllByRole("link")).toHaveLength(1);
  });

  it("puts the real action and a real link inside the open row - the point is that the person never has to find it", async () => {
    stubAll();
    renderChecklist();
    await screen.findByText("Review each scene");

    const open = list().querySelector('[data-current="true"]') as HTMLElement;
    // It names the actual control, not just the phase.
    expect(open.textContent).toContain("Approve Scenes");
    expect(within(open).getByRole("link", { name: "Open Scenes" }).getAttribute("href")).toBe(`/projects/${PROJECT_ID}/scenes`);
  });

  it("counts only genuinely finished steps - progress is read from persisted facts, never from pages visited", async () => {
    stubAll(executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null } }));
    renderChecklist();
    await screen.findByText("Review the complete video");

    // Upload, AI plan, review plan, scene mappings, first preview - five.
    // The final preview is NOT approved and nothing is rendered.
    screen.getByText("5 of 7 done");
    expect(list().querySelectorAll('[data-state="complete"] .project-checklist__marker')).toHaveLength(5);
  });

  it("THE DEAD END, CLOSED: a project with no Landscape master is pointed at Export, never at a tab the nav does not list", async () => {
    stubAll(executedProjectStubs());
    renderChecklist();
    await screen.findByText("Choose which part of the template is your finished video");

    const open = list().querySelector('[data-current="true"]') as HTMLElement;
    expect(within(open).getByRole("link", { name: "Open Export" }).getAttribute("href")).toBe(`/projects/${PROJECT_ID}/export`);
    expect(list().textContent).not.toContain("Render Settings");
    expect(list().textContent).not.toContain("Advanced");
  });

  it("reports the finished job as finished, with no action left to press", async () => {
    stubAll({
      ...executedProjectStubs({ renderOutputs: { LANDSCAPE: renderOutputFixture(), REELS: null }, sessionOverrides: { fullPreviewApproved: true } }),
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [renderArtifactFixture()] } }
    });
    renderChecklist();
    await screen.findByText("Everything is done");

    screen.getByText("7 of 7 done");
    expect(within(list()).queryAllByRole("link")).toHaveLength(0);
  });

  it("renders entirely in Hebrew, with no English leaking through", async () => {
    stubAll(executedProjectStubs());
    renderChecklist("he");
    await screen.findByText("הווידאו שלכם, שלב אחר שלב");

    within(list()).getByText("בחירת החלק בתבנית שהוא הווידאו המוגמר שלכם");
    within(list()).getByRole("link", { name: "פתיחת ייצוא" });
    expect(list().textContent).not.toContain("Choose which part of the template");
    expect(list().textContent).not.toContain("Do this now");
  });
});

/**
 * THE HARD RULE, and the reason this file exists at all: "never invent
 * state". A half-finished project whose status request failed used to
 * render as a confident "you are on step 2", because an absent session and
 * a failed fetch both arrived as `null`. A wrong instruction delivered
 * confidently is worse than no instruction - it is what put the operator on
 * the phone in the first place.
 */
describe("ProjectChecklist - never invents a step", () => {
  it("draws NO steps at all - not greyed, not guessed - when the real status cannot be read, and says which of 'checking' and 'failed' it is", async () => {
    stubAll({
      // Only the session call fails. Everything else succeeds, so any
      // lingering "best guess" behaviour would still have plenty to chew on.
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: {
        status: 500,
        body: { error: { code: "INTERNAL", message: "boom", requestId: "r1" } }
      }
    });
    renderChecklist();
    await screen.findByText("We cannot tell which step this project is on");

    expect(list().getAttribute("data-state")).toBe("failed");
    // Not one step row, not one status word, not one link to press.
    expect(list().querySelectorAll(".project-checklist__item")).toHaveLength(0);
    expect(within(list()).queryAllByRole("link")).toHaveLength(0);
    expect(list().textContent).not.toContain("Do this now");
    expect(list().textContent).not.toContain("Done");
    expect(list().textContent).not.toContain("of 7 done");
    // And none of the step names, which is what a guess would have printed.
    expect(list().textContent).not.toContain("Match Your Content");
    expect(list().textContent).not.toContain("First Preview");
  });

  it("distinguishes 'still checking' from 'could not check' - calling a failure a slow load is its own small lie", async () => {
    stubAll();
    renderChecklist();

    // The very first paint, before the extra status fetches have resolved.
    expect(list().getAttribute("data-state")).toBe("loading");
    screen.getByText("Checking where this project is…");
    expect(list().querySelectorAll(".project-checklist__item")).toHaveLength(0);

    // ...and it resolves into real steps on its own once they land.
    await screen.findByText("Your video, step by step");
    expect(list().querySelectorAll(".project-checklist__item")).toHaveLength(7);
  });
});
