// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectAssetsTab } from "./ProjectAssetsTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import { PROJECT_ID, assetFixture, manifestFixture, planFixture, projectDtoFixture, stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubWorkspace(assetsHandler: Parameters<typeof stubFetchByUrl>[0][string]): void {
  stubFetchByUrl({
    [`/api/projects/${PROJECT_ID}/assets`]: assetsHandler,
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
  });
}

function renderAssets(): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectAssetsTab />
    </ProjectWorkspaceProvider>
  );
}

describe("ProjectAssetsTab", () => {
  it('shows the honest empty state "No assets uploaded" when the project has none - never a fake asset', async () => {
    stubWorkspace({ status: 200, body: { assets: [] } });
    renderAssets();
    await screen.findByText("No assets uploaded");
  });

  it("renders the real asset from the API - filename, size, and SHA are the real stored values", async () => {
    stubWorkspace({
      status: 200,
      body: { assets: [assetFixture({ id: "asset-1", originalFilename: "hero-shot.png", byteSize: 2048, sha256: "b".repeat(64) })] }
    });
    renderAssets();
    await screen.findByText("hero-shot.png");
    screen.getByText("2.0 KB");
    screen.getByText("b".repeat(12));
  });

  it("uploads a real file and reflects it in the list once the API confirms it", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/assets`]: [
        { status: 200, body: { assets: [] } },
        { status: 201, body: { asset: assetFixture({ id: "asset-1", originalFilename: "new-upload.png" }) } },
        { status: 200, body: { assets: [assetFixture({ id: "asset-1", originalFilename: "new-upload.png" })] } }
      ],
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderAssets();
    await screen.findByText("No assets uploaded");

    const file = new File(["real bytes"], "new-upload.png", { type: "image/png" });
    const fileInput = document.getElementById("asset-file-input") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await screen.findByText("new-upload.png");
  });

  it("uses the danger button treatment for Delete and its confirm CTA, but never for Cancel (section J)", async () => {
    stubWorkspace({ status: 200, body: { assets: [assetFixture({ id: "asset-1", originalFilename: "keep-me.png" })] } });
    renderAssets();
    await screen.findByText("keep-me.png");

    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("btn--danger");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Delete this asset?");
    expect(screen.getByRole("button", { name: "Delete permanently" }).className).toContain("btn--danger");
    expect(screen.getByRole("button", { name: "Cancel" }).className).not.toContain("btn--danger");
  });

  it("asks for confirmation before deleting, and never deletes on cancel", async () => {
    stubWorkspace({ status: 200, body: { assets: [assetFixture({ id: "asset-1", originalFilename: "keep-me.png" })] } });
    renderAssets();
    await screen.findByText("keep-me.png");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Delete this asset?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Delete this asset?")).toBeNull());
    screen.getByText("keep-me.png");
  });

  it("deletes the asset once the confirmation is accepted", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/assets`]: [
        { status: 200, body: { assets: [assetFixture({ id: "asset-1", originalFilename: "remove-me.png" })] } },
        { status: 204, body: null },
        { status: 200, body: { assets: [] } }
      ],
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderAssets();
    await screen.findByText("remove-me.png");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Delete this asset?");
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await screen.findByText("No assets uploaded");
  });

  it("renders in Hebrew when the active locale is he - real translated strings, not English fallback text", async () => {
    stubWorkspace({ status: 200, body: { assets: [] } });
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectAssetsTab />
      </ProjectWorkspaceProvider>,
      { locale: "he" }
    );
    await screen.findByText("לא הועלו נכסים");
  });
});
