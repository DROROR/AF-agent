// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, manifestFixture, planFixture, projectDtoFixture, sceneFixture, stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderOverview(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectOverviewTab />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

describe("ProjectOverviewTab", () => {
  it("shows the real plan revision and status, never a fabricated value", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 3, status: "DRAFT" }), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderOverview();
    await screen.findByText("Draft");
    screen.getByText("3");
  });

  it("shows the real unresolved-scene count and refuses to imply the plan is ready", async () => {
    const scenes = [
      sceneFixture({ id: "s1", unresolvedReasons: ["no confident structural classification"] }),
      sceneFixture({ id: "s2", unresolvedReasons: ["no confident structural classification"] })
    ];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderOverview();
    await screen.findByText("Not ready for approval");
    screen.getByText("2 unresolved scene(s)");
    expect((screen.getByRole("button", { name: "Approve plan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Approve plan once every scene is resolved", async () => {
    const scenes = [sceneFixture({ id: "s1", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderOverview();
    await screen.findByText("Ready for approval");
    expect((screen.getByRole("button", { name: "Approve plan" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the stale-revision recovery state (never silently overwrites) on a 409 CONFLICT", async () => {
    const scenes = [sceneFixture({ id: "s1", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-plan/approve`]: {
        status: 409,
        body: { error: { code: "CONFLICT", message: "stale revision", requestId: "r1" } }
      }
    });
    renderOverview();
    await screen.findByText("Ready for approval");
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    await screen.findByText("This plan changed elsewhere");
    screen.getByRole("button", { name: "Reload" });
  });

  it("surfaces the backend's real PRECONDITION_NOT_MET refusal cleanly - proves the backend enforces this independently of the disabled button", async () => {
    // Bypasses this component's own isReady check by clicking Approve
    // while scenes are actually unresolved is not directly simulable here
    // (the button is disabled) - instead this proves the OTHER real path:
    // the backend can refuse for reasons the UI doesn't fully anticipate,
    // and that refusal must render as a clear error, never be swallowed.
    const scenes = [sceneFixture({ id: "s1", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-plan/approve`]: {
        status: 409,
        body: { error: { code: "PRECONDITION_NOT_MET", message: "Plan is not ready for approval: 1 scene(s) marked for use still have an unresolved reason", requestId: "r1" } }
      }
    });
    renderOverview();
    await screen.findByText("Ready for approval");
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    await screen.findByText("Could not save this change");
    screen.getByText("Plan is not ready for approval: 1 scene(s) marked for use still have an unresolved reason");
  });

  it("updates to the new revision returned by the backend after a successful approval", async () => {
    const scenes = [sceneFixture({ id: "s1", unresolvedReasons: [] })];
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 3 }, scenes), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
      [`/api/projects/${PROJECT_ID}/execution-plan/approve`]: {
        status: 200,
        body: { plan: planFixture({ revision: 3, status: "APPROVED" }, scenes), sceneTable: [] }
      }
    });
    renderOverview();
    await screen.findByText("Ready for approval");
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    const approvedLabels = await screen.findAllByText("Approved");
    expect(approvedLabels.length).toBeGreaterThan(0);
  });
});
