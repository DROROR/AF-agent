// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRevisionsTab } from "./ProjectRevisionsTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, manifestFixture, planFixture, projectDtoFixture, stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderRevisions(): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectRevisionsTab />
    </ProjectWorkspaceProvider>
  );
}

describe("ProjectRevisionsTab", () => {
  it("renders every real persisted revision, with the current one marked", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan/revisions`]: {
        status: 200,
        body: {
          revisions: [
            { revision: 3, status: "DRAFT", sceneCount: 45, approvedAt: null, approvedBy: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isCurrent: true },
            { revision: 2, status: "DRAFT", sceneCount: 45, approvedAt: null, approvedBy: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isCurrent: false },
            { revision: 1, status: "DRAFT", sceneCount: 45, approvedAt: null, approvedBy: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isCurrent: false }
          ]
        }
      },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({ revision: 3 }), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderRevisions();
    await screen.findByText("Current");
    expect(screen.getAllByText("45").length).toBe(3);
  });

  it("shows an honest empty state when there is no revision history yet", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan/revisions`]: { status: 404, body: { error: { code: "EXECUTION_PLAN_NOT_FOUND", message: "none", requestId: "r1" } } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 404, body: { error: { code: "EXECUTION_PLAN_NOT_FOUND", message: "none", requestId: "r1" } } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderRevisions();
    await screen.findByText("No revisions yet");
  });
});
