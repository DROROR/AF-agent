// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendersPage } from "./RendersPage";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  manifestFixture,
  planFixture,
  projectDtoFixture,
  renderArtifactFixture,
  stubFetchByUrl
} from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubProject(renderArtifactsHandler: Parameters<typeof stubFetchByUrl>[0][string]): void {
  stubFetchByUrl({
    "/api/projects": { status: 200, body: { projects: [projectDtoFixture()] } },
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}/render-artifacts`]: renderArtifactsHandler,
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
  });
}

describe("RendersPage", () => {
  it('shows the honest empty state "No renders yet" when the selected project has none - never a fake render card', async () => {
    stubProject({ status: 200, body: { artifacts: [] } });
    renderWithLocale(<RendersPage />);
    await screen.findByText("No renders yet");
  });

  it("shows the honest no-projects state when there are no projects at all", async () => {
    stubFetchByUrl({ "/api/projects": { status: 200, body: { projects: [] } } });
    renderWithLocale(<RendersPage />);
    await screen.findByText("No projects yet");
  });

  it("renders a real persisted render artifact - variant, composition, size, and a real download link", async () => {
    stubProject({
      status: 200,
      body: { artifacts: [renderArtifactFixture({ variant: "LANDSCAPE", compositionName: "Landscape Master", byteSize: 2048 })] }
    });
    renderWithLocale(<RendersPage />);

    await screen.findByText("Landscape Master");
    screen.getByText("Landscape");
    screen.getByText("2.0 KB");
    const downloadLink = screen.getByRole("link", { name: "Download" });
    expect(downloadLink.getAttribute("href")).toBe(
      `/api/projects/${PROJECT_ID}/render-artifacts/33333333-3333-3333-3333-333333333333/file`
    );
  });

  it("renders in Hebrew when the active locale is he - real translated strings, not English fallback text", async () => {
    stubProject({ status: 200, body: { artifacts: [] } });
    renderWithLocale(<RendersPage />, { locale: "he" });
    await screen.findByText("אין עדיין רינדורים");
  });
});
