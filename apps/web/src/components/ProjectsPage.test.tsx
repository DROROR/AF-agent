// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectsPage } from "./ProjectsPage";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, manifestFixture, planFixture, projectDtoFixture, stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProjectsPage", () => {
  it("renders the real project from production data, never a hardcoded value", async () => {
    stubFetchByUrl({
      "/api/projects": { status: 200, body: { projects: [projectDtoFixture()] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWithLocale(<ProjectsPage />);

    await screen.findByText("White App Promo");
    screen.getByText("White App Promo (converted).aep");
    screen.getByText("Draft");
    screen.getByText("3");
  });

  it("shows an honest empty state when there are genuinely zero projects", async () => {
    stubFetchByUrl({ "/api/projects": { status: 200, body: { projects: [] } } });
    renderWithLocale(<ProjectsPage />);
    await screen.findByText("No projects yet");
  });

  it("shows an error state (never fabricated data) when the project list API fails", async () => {
    stubFetchByUrl({ "/api/projects": { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "boom", requestId: "r1" } } } });
    renderWithLocale(<ProjectsPage />);
    await screen.findByText("Projects unavailable");
  });

  it("shows a clean '—' rather than a fabricated value when a project's manifest/plan enrichment fails", async () => {
    stubFetchByUrl({
      "/api/projects": { status: 200, body: { projects: [projectDtoFixture()] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 404, body: { error: { code: "EXECUTION_PLAN_NOT_FOUND", message: "none", requestId: "r1" } } },
      [`/api/projects/${PROJECT_ID}`]: { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "boom", requestId: "r1" } } }
    });

    renderWithLocale(<ProjectsPage />);
    await screen.findByText("White App Promo");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
