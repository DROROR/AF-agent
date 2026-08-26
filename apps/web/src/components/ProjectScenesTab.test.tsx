// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectScenesTab } from "./ProjectScenesTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
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
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectScenesTab />
    </ProjectWorkspaceProvider>
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
});
