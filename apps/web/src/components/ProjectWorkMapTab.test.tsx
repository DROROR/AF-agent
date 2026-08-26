// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkMapTab } from "./ProjectWorkMapTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  manifestFixture,
  planFixture,
  projectDtoFixture,
  stubFetchByUrl,
  workMapEntryFixture,
  workMapFixture
} from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubWorkspace(workMapHandler: Parameters<typeof stubFetchByUrl>[0][string]): void {
  stubFetchByUrl({
    [`/api/projects/${PROJECT_ID}/work-map`]: workMapHandler,
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
  });
}

function renderWorkMap(): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectWorkMapTab />
    </ProjectWorkspaceProvider>
  );
}

describe("ProjectWorkMapTab", () => {
  it("shows an honest empty state when no work map has been saved yet - never a fake row", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap();
    await screen.findByText("No work map entries yet");
  });

  it("renders the real saved entry - never pretends an unresolved scene is understood", async () => {
    stubWorkspace({
      status: 200,
      body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceReference: "Opening scene", desiredText: "Hello world" })]) }
    });
    renderWorkMap();
    await screen.findByText("Opening scene");
    expect((screen.getByLabelText("Desired text") as HTMLInputElement).value).toBe("Hello world");
  });

  it("saves an edited entry and reflects the new revision the backend returns", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/work-map`]: [
        { status: 200, body: { workMap: workMapFixture({ revision: 1 }, [workMapEntryFixture({ desiredText: "Hello world" })]) } },
        { status: 200, body: { workMap: workMapFixture({ revision: 2 }, [workMapEntryFixture({ desiredText: "Updated text" })]) } }
      ],
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWorkMap();
    const textField = (await screen.findByLabelText("Desired text")) as HTMLInputElement;
    expect(textField.value).toBe("Hello world");
    fireEvent.change(textField, { target: { value: "Updated text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save work map" }));

    await waitFor(() => {
      expect((screen.getByLabelText("Desired text") as HTMLInputElement).value).toBe("Updated text");
    });
  });

  it("shows the stale-revision recovery message (never silently overwrites) on a 409 CONFLICT", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/work-map`]: [
        { status: 200, body: { workMap: workMapFixture({ revision: 1 }) } },
        { status: 409, body: { error: { code: "CONFLICT", message: "stale revision", requestId: "r1" } } }
      ],
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWorkMap();
    await screen.findByLabelText("Desired text");
    fireEvent.click(screen.getByRole("button", { name: "Save work map" }));

    await screen.findByText("This plan changed elsewhere");
  });

  it("adds and removes rows locally before saving", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap();
    await screen.findByText("No work map entries yet");

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    await screen.findByLabelText("Desired text");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("No work map entries yet");
  });

  it("renders in Hebrew when the active locale is he", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectWorkMapTab />
      </ProjectWorkspaceProvider>,
      { locale: "he" }
    );
    await screen.findByText("אין עדיין רשומות במפת העבודה");
  });
});
