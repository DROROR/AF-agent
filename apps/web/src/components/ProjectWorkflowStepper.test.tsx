// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
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
  it('shows "Step 2 of 7 — Tell Claude" as current for a fresh project with no Work Map yet', async () => {
    stubWorkspace();
    renderStepper();
    await screen.findByText("Step 2 of 7 — Tell Claude");
    screen.getByText("Describe your video in plain language and let Claude draft a plan.");
  });

  it("locks every step after the current one - a locked step is never a clickable link", async () => {
    stubWorkspace();
    renderStepper();
    await screen.findByText("Step 2 of 7 — Tell Claude");

    const renderStep = screen.getByText("Render").closest("li");
    expect(renderStep?.querySelector("a")).toBeNull();
    expect(renderStep?.getAttribute("data-state")).toBe("locked");
  });

  it("marks Upload complete and shows a real link (not locked) for the current step", async () => {
    stubWorkspace();
    renderStepper();
    await screen.findByText("Step 2 of 7 — Tell Claude");

    const uploadStep = screen.getByText("Upload").closest("li");
    expect(uploadStep?.getAttribute("data-state")).toBe("complete");

    const tellClaudeStep = screen.getByText("Tell Claude").closest("li");
    expect(tellClaudeStep?.querySelector("a")).not.toBeNull();
  });

  it("advances past Tell Claude and Review Plan once a real Work Map and execution plan exist", async () => {
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } }
    });
    renderStepper();
    await screen.findByText("Step 4 of 7 — Mappings");
  });

  it("Scene Mappings only completes once the plan is APPROVED, not merely created", async () => {
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }), sceneTable: [] } }
    });
    renderStepper();
    await screen.findByText("Step 5 of 7 — First Preview");
  });

  it("reaches the final Render step once every real prerequisite is satisfied", async () => {
    const scene = sceneFixture({ id: "scene-1", use: true, approvalState: "APPROVED", unresolvedReasons: [] });
    stubWorkspace({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture()]) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ status: "APPROVED" }, [scene]), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}/execution-sessions/current`]: {
        status: 200,
        body: { session: sessionFixture({ firstPreviewApproved: true, completedScenePlanIds: ["scene-1"], status: "READY_TO_RENDER" }) }
      },
      [`/api/projects/${PROJECT_ID}/render-artifacts`]: { status: 200, body: { artifacts: [renderArtifactFixture()] } }
    });
    renderStepper();
    await screen.findByText("Step 7 of 7 — Render");
  });
});
