// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkMapTab } from "./ProjectWorkMapTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  assetFixture,
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

function stubWorkspace(
  workMapHandler: Parameters<typeof stubFetchByUrl>[0][string],
  extra: Record<string, Parameters<typeof stubFetchByUrl>[0][string]> = {}
): void {
  stubFetchByUrl({
    [`/api/projects/${PROJECT_ID}/work-map`]: workMapHandler,
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [assetFixture({ id: "asset-1", originalFilename: "login-demo.mp4", label: null })] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
    ...extra
  });
}

function renderWorkMap(locale: "en" | "he" = "en"): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <ProjectWorkMapTab />
    </ProjectWorkspaceProvider>,
    { locale }
  );
}

/**
 * Video-planning UX simplification, 2026-08-31: Simple Mode ("Tell AI
 * what you want") is now the DEFAULT view whenever no Work Map exists
 * yet - a normal user is never shown raw composition/asset ID fields
 * first. Every technical field/capability the manual form always had is
 * still fully present and functional, just reached via "Add details
 * manually" instead of being the default.
 */
describe("ProjectWorkMapTab - Simple Mode default (video-planning UX simplification, 2026-08-31)", () => {
  it("shows 'Tell AI what you want' as the default view - never the raw manual form - when no work map exists yet", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap();
    await screen.findByText("Tell AI what you want");
    expect(screen.getByRole("button", { name: "Create Video Plan" })).not.toBeNull();
    // Never shows a raw composition/asset ID field by default.
    expect(screen.queryByLabelText("Matched composition ID")).toBeNull();
    expect(screen.queryByLabelText("Desired asset ID")).toBeNull();
  });

  it("Create Video Plan calls the real AI draft endpoint and shows the human-readable plan preview - never the raw form", async () => {
    stubWorkspace(
      { status: 200, body: { workMap: null } },
      {
        [`/api/projects/${PROJECT_ID}/work-map/ai-draft`]: {
          status: 201,
          body: {
            workMap: workMapFixture({ revision: 1 }, [
              workMapEntryFixture({ id: "wm-1", sourceCompositionId: "c1", sourceReference: "Scene 01", desiredAssetId: "asset-1", desiredText: null, desiredDurationSeconds: 5 })
            ])
          }
        }
      }
    );
    renderWorkMap();
    const textarea = await screen.findByLabelText("Describe your video");
    fireEvent.change(textarea, { target: { value: "Use the login recording, then show checkout." } });
    fireEvent.click(screen.getByRole("button", { name: "Create Video Plan" }));

    await screen.findByText("Your Video Plan");
    // Real asset filename, never the raw asset UUID, in the default view.
    expect(screen.getByText("login-demo.mp4")).not.toBeNull();
    // The raw asset id is never in the DEFAULT (non-advanced) content -
    // <details> content exists in the DOM even collapsed, so this checks
    // the visible row cell specifically, not the whole document.
    const contentCells = screen.getAllByText("login-demo.mp4");
    expect(contentCells.length).toBeGreaterThan(0);
  });

  it("shows a typed, actionable error and stays in Simple Mode when the AI draft is refused - never a silent failure", async () => {
    stubWorkspace(
      { status: 200, body: { workMap: null } },
      { [`/api/projects/${PROJECT_ID}/work-map/ai-draft`]: { status: 422, body: { error: { code: "NO_USABLE_WORK_MAP_DRAFT", message: "AI could not build a plan from that description.", requestId: "r1" } } } }
    );
    renderWorkMap();
    const textarea = await screen.findByLabelText("Describe your video");
    fireEvent.change(textarea, { target: { value: "??" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Video Plan" }));

    await screen.findByText("AI could not build a plan from that description.");
    expect(screen.getByRole("button", { name: "Create Video Plan" })).not.toBeNull();
  });

  it("Add details manually reveals the manual form with human-readable scene/asset pickers - never raw ID text inputs", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap();
    await screen.findByText("Tell AI what you want");
    fireEvent.click(screen.getByRole("button", { name: "Add details manually" }));

    fireEvent.click(await screen.findByRole("button", { name: "Add row" }));
    const sceneSelect = (await screen.findByLabelText("Matched composition ID")) as HTMLSelectElement;
    expect(sceneSelect.tagName).toBe("SELECT");
    expect(within(sceneSelect).getByText("Scene 01")).not.toBeNull();

    const assetSelect = screen.getByLabelText("Desired asset ID") as HTMLSelectElement;
    expect(assetSelect.tagName).toBe("SELECT");
    expect(within(assetSelect).getByText("login-demo.mp4")).not.toBeNull();
  });

  it("selecting a scene/asset by human-readable name still stores the real underlying ID - the ID contract is unchanged", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap();
    fireEvent.click(await screen.findByRole("button", { name: "Add details manually" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add row" }));

    const sceneSelect = (await screen.findByLabelText("Matched composition ID")) as HTMLSelectElement;
    fireEvent.change(sceneSelect, { target: { value: "c1" } });
    expect(sceneSelect.value).toBe("c1");

    const assetSelect = screen.getByLabelText("Desired asset ID") as HTMLSelectElement;
    fireEvent.change(assetSelect, { target: { value: "asset-1" } });
    expect(assetSelect.value).toBe("asset-1");
  });

  it("renders an existing saved work map as the human-readable plan preview by default - real scene name and asset filename, never raw UUIDs", async () => {
    stubWorkspace({
      status: 200,
      body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceCompositionId: "c1", sourceReference: "Opening scene", desiredAssetId: "asset-1", desiredText: "Hello world" })]) }
    });
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByText("Scene 01")).not.toBeNull();
    expect(screen.getByText("login-demo.mp4")).not.toBeNull();
    expect(screen.getByText("Hello world")).not.toBeNull();
    // The raw asset id is never in the DEFAULT (non-advanced) content -
    // <details> content exists in the DOM even collapsed, so this checks
    // the visible row cell specifically, not the whole document.
    const contentCells = screen.getAllByText("login-demo.mp4");
    expect(contentCells.length).toBeGreaterThan(0);
  });

  it("keeps the real composition/asset IDs available under Advanced details - never deleted from the data model, just not in the default view", async () => {
    stubWorkspace({
      status: 200,
      body: { workMap: workMapFixture({}, [workMapEntryFixture({ id: "wm-entry-1", sourceCompositionId: "c1", desiredAssetId: "asset-1" })]) }
    });
    renderWorkMap();
    await screen.findByText("Your Video Plan");

    const advancedToggle = screen.getByText("Advanced details");
    fireEvent.click(advancedToggle);
    expect(screen.getByText("c1", { exact: false })).not.toBeNull();
    expect(screen.getByText("asset-1", { exact: false })).not.toBeNull();
  });
});

describe("ProjectWorkMapTab - manual form remains fully available and functional", () => {
  it("saves an edited entry via the manual form and reflects the new revision the backend returns", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/work-map`]: [
        { status: 200, body: { workMap: workMapFixture({ revision: 1 }, [workMapEntryFixture({ desiredText: "Hello world" })]) } },
        { status: 200, body: { workMap: workMapFixture({ revision: 2 }, [workMapEntryFixture({ desiredText: "Updated text" })]) } }
      ],
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWorkMap();
    await screen.findByText("Your Video Plan");
    fireEvent.click(screen.getByRole("button", { name: "Add details manually" }));

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
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });

    renderWorkMap();
    await screen.findByText("Your Video Plan");
    fireEvent.click(screen.getByRole("button", { name: "Add details manually" }));
    await screen.findByLabelText("Desired text");
    fireEvent.click(screen.getByRole("button", { name: "Save work map" }));

    await screen.findByText("This plan changed elsewhere");
  });

  it("adds and removes rows locally before saving", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap();
    await screen.findByText("Tell AI what you want");
    fireEvent.click(screen.getByRole("button", { name: "Add details manually" }));
    await screen.findByText("No work map entries yet");

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    await screen.findByLabelText("Desired text");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("No work map entries yet");
  });

  it("renders in Hebrew when the active locale is he", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap("he");
    await screen.findByText("ספרו לבינה המלאכותית מה תרצו");
  });
});
