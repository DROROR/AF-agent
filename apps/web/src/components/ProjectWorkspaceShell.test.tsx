// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, manifestFixture, planFixture, projectDtoFixture, stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => `/projects/${PROJECT_ID}`,
  useRouter: () => ({ push: pushMock })
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pushMock.mockClear();
});

function renderShell(): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectWorkspaceShell projectId={PROJECT_ID}>
        <div>tab content</div>
      </ProjectWorkspaceShell>
    </ProjectWorkspaceProvider>
  );
}

function stubWorkspace(): void {
  stubFetchByUrl({
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
  });
}

/**
 * Offline-safe-control-plane phase, section 1 ("Add Delete Project") -
 * Delete Project must require an explicit confirmation showing the real
 * project name (never one-click), and must never claim success without a
 * real 204 from the API.
 */
describe("ProjectWorkspaceShell - Delete Project", () => {
  it("shows a Delete Project action that opens a confirmation naming the real project - never deletes on the first click", async () => {
    stubWorkspace();
    renderShell();
    await screen.findByText("White App Promo");

    fireEvent.click(screen.getByRole("button", { name: "Delete Project" }));
    await screen.findByText("Delete this project?");
    screen.getByText('"White App Promo" and everything in it (uploads, work map, scene mappings, previews, and renders) will be permanently deleted. This cannot be undone.');
    // Not deleted yet - the tab content (and the project) is still there.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("uses the danger button treatment for Delete Project and its confirm CTA, but never for Cancel (section J)", async () => {
    stubWorkspace();
    renderShell();
    await screen.findByText("White App Promo");

    expect(screen.getByRole("button", { name: "Delete Project" }).className).toContain("btn--danger");
    fireEvent.click(screen.getByRole("button", { name: "Delete Project" }));
    await screen.findByText("Delete this project?");
    expect(screen.getByRole("button", { name: "Delete permanently" }).className).toContain("btn--danger");
    expect(screen.getByRole("button", { name: "Cancel" }).className).not.toContain("btn--danger");
  });

  it("cancel leaves the project untouched - no delete request is ever sent", async () => {
    stubWorkspace();
    renderShell();
    await screen.findByRole("button", { name: "Delete Project" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Project" }));
    await screen.findByText("Delete this project?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Delete this project?")).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("confirming delete calls the real DELETE endpoint and navigates back to the Projects list on success", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: [
        { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
        { status: 204, body: null }
      ]
    });
    renderShell();
    await screen.findByRole("button", { name: "Delete Project" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Project" }));
    await screen.findByText("Delete this project?");
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/projects");
    });
  });

  it("shows a typed, actionable error and never navigates away when the API refuses (e.g. an active job)", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: [
        { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
        { status: 409, body: { error: { code: "PROJECT_HAS_ACTIVE_JOB", message: "Project has a job still in progress - wait for it to finish before deleting", requestId: "r1" } } }
      ]
    });
    renderShell();
    await screen.findByRole("button", { name: "Delete Project" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Project" }));
    await screen.findByText("Delete this project?");
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await screen.findByText("Project has a job still in progress - wait for it to finish before deleting");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
