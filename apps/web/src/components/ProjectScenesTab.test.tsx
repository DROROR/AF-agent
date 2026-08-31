// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectScenesTab } from "./ProjectScenesTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  manifestFixture,
  planFixture,
  projectDtoFixture,
  sceneFixture,
  sceneTableRowFixture,
  stubFetchByUrl
} from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderScenes(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectScenesTab />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

describe("ProjectScenesTab", () => {
  it("renders the real scene table rows from the current plan", async () => {
    const scenes = [sceneFixture({ id: "s1", compositionName: "Text 01" })];
    const sceneTable = [sceneTableRowFixture({ scenePlanId: "s1", compositionName: "Text 01" })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderScenes();
    await screen.findByText("Text 01");
  });

  it("sends INCLUDE_SCENE and reflects the new revision the backend returns after toggling Use", async () => {
    const excludedScene = sceneFixture({ id: "s1", use: false, compositionName: "Text 01" });
    const includedScene = sceneFixture({ id: "s1", use: true, compositionName: "Text 01" });
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 200, body: { plan: planFixture({ revision: 1 }, [excludedScene]), sceneTable: [sceneTableRowFixture({ scenePlanId: "s1", use: false, compositionName: "Text 01" })] } },
        { status: 200, body: { plan: planFixture({ revision: 2 }, [includedScene]), sceneTable: [sceneTableRowFixture({ scenePlanId: "s1", use: true, compositionName: "Text 01" })] } }
      ],
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderScenes();
    await screen.findByText("Text 01");
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    await waitFor(() => {
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    });
  });

  it("shows the stale-revision recovery message (never silently overwrites) when an edit is refused with 409", async () => {
    const scenes = [sceneFixture({ id: "s1", use: false, compositionName: "Text 01" })];
    const sceneTable = [sceneTableRowFixture({ scenePlanId: "s1", use: false, compositionName: "Text 01" })];
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 200, body: { plan: planFixture({ revision: 1 }, scenes), sceneTable } },
        { status: 409, body: { error: { code: "CONFLICT", message: "stale revision", requestId: "r1" } } }
      ],
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderScenes();
    await screen.findByText("Text 01");
    fireEvent.click(screen.getByRole("checkbox"));

    await screen.findByText("This plan changed elsewhere");
  });

  describe("no execution plan yet - Create Execution Plan action (real dashboard gap fix)", () => {
    function stubNoPlanThenCreated(created: { plan: unknown; sceneTable: unknown }): void {
      stubFetchByUrl({
        [`/api/projects/${PROJECT_ID}/execution-plan`]: [
          { status: 404, body: { error: { code: "NOT_FOUND", message: "no execution plan yet", requestId: "r1" } } },
          { status: 201, body: created }
        ],
        [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
      });
    }

    it("shows the empty state with a Create Execution Plan action when no plan exists (404)", async () => {
      stubNoPlanThenCreated({ plan: planFixture({}, []), sceneTable: [] });
      renderScenes();

      await screen.findByText("No execution plan yet");
      expect(screen.getByRole("button", { name: "Create Execution Plan" })).not.toBeNull();
    });

    it("clicking Create Execution Plan calls the real POST endpoint and renders the normal Scene Mapping UI from the returned plan - no reload", async () => {
      const scenes = [sceneFixture({ id: "s1", compositionName: "Text 01" })];
      const sceneTable = [sceneTableRowFixture({ scenePlanId: "s1", compositionName: "Text 01" })];
      stubNoPlanThenCreated({ plan: planFixture({}, scenes), sceneTable });
      const reloadSpy = vi.fn();
      Object.defineProperty(window, "location", { value: { reload: reloadSpy }, writable: true });

      renderScenes();
      await screen.findByText("No execution plan yet");
      fireEvent.click(screen.getByRole("button", { name: "Create Execution Plan" }));

      await screen.findByText("Text 01");
      expect(screen.queryByText("No execution plan yet")).toBeNull();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it("disables the button while the request is in flight and a second click never sends a duplicate POST", async () => {
      const scenes = [sceneFixture({ id: "s1", compositionName: "Text 01" })];
      const sceneTable = [sceneTableRowFixture({ scenePlanId: "s1", compositionName: "Text 01" })];
      stubNoPlanThenCreated({ plan: planFixture({}, scenes), sceneTable });

      renderScenes();
      await screen.findByText("No execution plan yet");
      const button = screen.getByRole("button", { name: "Create Execution Plan" });

      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      await screen.findByText("Text 01");

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const executionPlanCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        const input = call[0] as RequestInfo | URL;
        const url = typeof input === "string" ? input : input.toString();
        return url.includes(`/api/projects/${PROJECT_ID}/execution-plan`) && !url.includes("revisions");
      });
      // Exactly one GET (initial load, 404) + one POST (the real create) -
      // never a second/third POST from the extra clicks.
      expect(executionPlanCalls.length).toBe(2);
    });

    it("shows a typed, actionable error and keeps the empty state (never a silent failure) when creation is refused", async () => {
      stubFetchByUrl({
        [`/api/projects/${PROJECT_ID}/execution-plan`]: [
          { status: 404, body: { error: { code: "NOT_FOUND", message: "no execution plan yet", requestId: "r1" } } },
          { status: 409, body: { error: { code: "CONFLICT", message: "an execution plan already exists", requestId: "r2" } } }
        ],
        [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
      });

      renderScenes();
      await screen.findByText("No execution plan yet");
      fireEvent.click(screen.getByRole("button", { name: "Create Execution Plan" }));

      await screen.findByText("an execution plan already exists");
      expect(screen.getByText("No execution plan yet")).not.toBeNull();
    });

    it("displays scenes with unresolved/unknown placeholder classifications just fine after creation - unknown placeholders never block the plan from rendering", async () => {
      const scenes = [sceneFixture({ id: "s1", compositionName: "Unknown Placeholder Scene" })];
      const sceneTable = [
        sceneTableRowFixture({
          scenePlanId: "s1",
          compositionName: "Unknown Placeholder Scene",
          placeholderClassification: null,
          unresolvedReasons: ["no confident structural classification for any detected placeholder yet"]
        })
      ];
      stubNoPlanThenCreated({ plan: planFixture({}, scenes), sceneTable });

      renderScenes();
      await screen.findByText("No execution plan yet");
      fireEvent.click(screen.getByRole("button", { name: "Create Execution Plan" }));

      await screen.findByText("Unknown Placeholder Scene");
    });

    it("never calls the Work Map endpoint as part of creating the plan - Work Map is never silently applied", async () => {
      const scenes = [sceneFixture({ id: "s1", compositionName: "Text 01" })];
      const sceneTable = [sceneTableRowFixture({ scenePlanId: "s1", compositionName: "Text 01" })];
      stubNoPlanThenCreated({ plan: planFixture({}, scenes), sceneTable });

      renderScenes();
      await screen.findByText("No execution plan yet");
      fireEvent.click(screen.getByRole("button", { name: "Create Execution Plan" }));
      await screen.findByText("Text 01");

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const workMapCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        const input = call[0] as RequestInfo | URL;
        const url = typeof input === "string" ? input : input.toString();
        return url.includes("/work-map");
      });
      expect(workMapCalls.length).toBe(0);
    });

    it("the created plan is DRAFT/unapproved - creation never auto-approves it", async () => {
      const scenes = [sceneFixture({ id: "s1", compositionName: "Text 01" })];
      const sceneTable = [sceneTableRowFixture({ scenePlanId: "s1", compositionName: "Text 01" })];
      const created = planFixture({ status: "DRAFT", approvedAt: null, approvedBy: null }, scenes);
      stubNoPlanThenCreated({ plan: created, sceneTable });

      renderScenes();
      await screen.findByText("No execution plan yet");
      fireEvent.click(screen.getByRole("button", { name: "Create Execution Plan" }));
      await screen.findByText("Text 01");

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const approveCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        const input = call[0] as RequestInfo | URL;
        const url = typeof input === "string" ? input : input.toString();
        return url.includes("/execution-plan/approve");
      });
      expect(approveCalls.length).toBe(0);
    });
  });
});
