// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkflowStepper } from "./ProjectWorkflowStepper";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, manifestFixture, planFixture, projectDtoFixture, renderArtifactFixture, sceneFixture, stubFetchByUrl, workMapEntryFixture, workMapFixture } from "../test-utils/execution-plan-fixtures";

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
    sourceProjectSha256: "a".repeat(64),
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

function stubWorkspace(overrides: Record<string, Parameters<typeof stubFetchByUrl>[0][string]> = {}): void {
  stubFetchByUrl({
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
    [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: null } },
    [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: { status: 200, body: { session: null } },
    [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [] } },
    ...overrides
  });
}

function renderStepper(): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectWorkflowStepper />
    </ProjectWorkspaceProvider>
  );
}

describe("ProjectWorkflowStepper", () => {
  it('shows "Step 2 of 7 — AI Plan" as current for a fresh project with no Work Map yet', async () => {
    stubWorkspace();
    renderStepper();
    await screen.findByText("Step 2 of 7 — AI Plan");
    screen.getByText("AI is planning how to use your template and content.");
  });

  it("locks every step after the current one - a locked step is never a clickable link", async () => {
    stubWorkspace();
    renderStepper();
    await screen.findByText("Step 2 of 7 — AI Plan");

    const renderStep = screen.getByText("Export Video").closest("li");
    expect(renderStep?.querySelector("a")).toBeNull();
    expect(renderStep?.getAttribute("data-state")).toBe("locked");
  });

  it("marks Upload complete and shows a real link (not locked) for the current step", async () => {
    stubWorkspace();
    renderStepper();
    await screen.findByText("Step 2 of 7 — AI Plan");

    const uploadStep = screen.getByText("Upload").closest("li");
    expect(uploadStep?.getAttribute("data-state")).toBe("complete");

    const tellClaudeStep = screen.getByText("AI Plan").closest("li");
    expect(tellClaudeStep?.querySelector("a")).not.toBeNull();
  });

  it("advances past AI Plan and Review Plan once a real Work Map and execution plan exist", async () => {
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } }
    });
    renderStepper();
    await screen.findByText("Step 4 of 7 — Match Your Content");
  });

  it("Scene Mappings only completes once the plan is APPROVED, not merely created", async () => {
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }), sceneTable: [] } }
    });
    renderStepper();
    await screen.findByText("Step 5 of 7 — First Preview");
  });

  it("Final Preview stays current (never complete) and Render stays locked once every scene is done but the complete preview has not been approved yet - client-handoff phase, 'real final preview approval gate'", async () => {
    const scene = sceneFixture({ id: "scene-1", use: true, approvalState: "APPROVED", unresolvedReasons: [] });
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, [scene]), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: {
        status: 200,
        body: { session: sessionFixture({ firstPreviewApproved: true, completedScenePlanIds: ["scene-1"], status: "READY_TO_RENDER", fullPreviewApproved: false }) }
      }
    });
    renderStepper();
    await screen.findByText("Step 6 of 7 — Final Preview");

    const renderStep = screen.getByText("Export Video").closest("li");
    expect(renderStep?.getAttribute("data-state")).toBe("locked");
  });

  it("reaches the final Export Video step once every real prerequisite is satisfied", async () => {
    const scene = sceneFixture({ id: "scene-1", use: true, approvalState: "APPROVED", unresolvedReasons: [] });
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, [scene]), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: {
        status: 200,
        body: { session: sessionFixture({ firstPreviewApproved: true, completedScenePlanIds: ["scene-1"], status: "READY_TO_RENDER", fullPreviewApproved: true }) }
      },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [renderArtifactFixture()] } }
    });
    renderStepper();
    await screen.findByText("Step 7 of 7 — Export Video");
  });
});

/**
 * Final Simple Mode UX pass - stepper clarity. The underlying state
 * (computeWorkflowSteps, unit-tested in project-workflow-steps.test.ts)
 * was already correct: Step 2 (AI Plan) complete / Step 3 (Review AI
 * Plan) current / Step 4 (Match Your Content) locked once a Work Map
 * draft exists but no execution plan does yet - CASE A/B here confirm
 * that real state renders with visually distinct complete/current/locked
 * markup (CASE C), not just correct internal state.
 */
describe("ProjectWorkflowStepper - visually distinct Complete/Current/Locked states (final Simple Mode UX pass)", () => {
  it("CASE A: AI Plan Complete, Review AI Plan Current, Match Your Content Locked - each with a distinct data-state and marker", async () => {
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 404, body: { error: { code: "NOT_FOUND", message: "none", requestId: "r1" } } }
    });
    renderStepper();
    await screen.findByText("Step 3 of 7 — Review AI Plan");

    const aiPlanItem = screen.getByText("AI Plan").closest("li")!;
    expect(aiPlanItem.getAttribute("data-state")).toBe("complete");
    // A checkmark icon (not a plain digit) marks the complete step.
    expect(aiPlanItem.querySelector(".workflow-stepper__marker svg")).not.toBeNull();

    const reviewPlanItem = screen.getByText("Review AI Plan").closest("li")!;
    expect(reviewPlanItem.getAttribute("data-state")).toBe("current");
    expect(reviewPlanItem.querySelector("a")).not.toBeNull();
    // CASE C: the current step's own status text is unmistakably "Current".
    const status = within(reviewPlanItem).getByText("Current");
    expect(status).not.toBeNull();

    const matchContentItem = screen.getByText("Match Your Content").closest("li")!;
    expect(matchContentItem.getAttribute("data-state")).toBe("locked");
    expect(matchContentItem.querySelector("a")).toBeNull();
    // A lock icon (not a plain digit) marks the locked step.
    expect(matchContentItem.querySelector(".workflow-stepper__marker svg")).not.toBeNull();
  });

  it("CASE B: once the execution plan exists, Review AI Plan becomes Complete and Match Your Content becomes Current/unlocked", async () => {
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } }
    });
    renderStepper();
    await screen.findByText("Step 4 of 7 — Match Your Content");

    const reviewPlanItem = screen.getByText("Review AI Plan").closest("li")!;
    expect(reviewPlanItem.getAttribute("data-state")).toBe("complete");

    const matchContentItem = screen.getByText("Match Your Content").closest("li")!;
    expect(matchContentItem.getAttribute("data-state")).toBe("current");
    expect(matchContentItem.querySelector("a")).not.toBeNull();
    expect(within(matchContentItem).getByText("Current")).not.toBeNull();
  });
});
