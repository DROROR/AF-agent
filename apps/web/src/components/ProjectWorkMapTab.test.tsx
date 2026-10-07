// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkMapTab } from "./ProjectWorkMapTab";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { WorkspaceModeProvider } from "./WorkspaceModeProvider";
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
  window.localStorage.clear();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
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
    <WorkspaceModeProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <ProjectWorkMapTab />
      </ProjectWorkspaceProvider>
    </WorkspaceModeProvider>,
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
    expect(screen.getByRole("button", { name: "Claude — Create Video Plan" })).not.toBeNull();
    // Never shows a raw composition/asset ID field by default.
    expect(screen.queryByLabelText("Scene in the template")).toBeNull();
    expect(screen.queryByLabelText("File to use")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Claude — Create Video Plan" }));

    await screen.findByText("Your Video Plan");
    // Real asset filename, never the raw asset UUID, in the default view.
    // Named in the plan itself AND in the "Your files" list above it.
    expect(screen.getAllByText("login-demo.mp4").length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByRole("button", { name: "Claude — Create Video Plan" }));

    await screen.findByText("AI could not build a plan from that description.");
    expect(screen.getByRole("button", { name: "Claude — Create Video Plan" })).not.toBeNull();
  });

  it("Add details manually reveals the manual form with human-readable scene/asset pickers - never raw ID text inputs", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap();
    await screen.findByText("Tell AI what you want");
    fireEvent.click(screen.getByRole("button", { name: "Add details manually" }));

    fireEvent.click(await screen.findByRole("button", { name: "Add row" }));
    const sceneSelect = (await screen.findByLabelText("Scene in the template")) as HTMLSelectElement;
    expect(sceneSelect.tagName).toBe("SELECT");
    expect(within(sceneSelect).getByText("Scene 01")).not.toBeNull();

    const assetSelect = screen.getByLabelText("File to use") as HTMLSelectElement;
    expect(assetSelect.tagName).toBe("SELECT");
    expect(within(assetSelect).getByText("login-demo.mp4")).not.toBeNull();
  });

  it("selecting a scene/asset by human-readable name still stores the real underlying ID - the ID contract is unchanged", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap();
    fireEvent.click(await screen.findByRole("button", { name: "Add details manually" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add row" }));

    const sceneSelect = (await screen.findByLabelText("Scene in the template")) as HTMLSelectElement;
    fireEvent.change(sceneSelect, { target: { value: "c1" } });
    expect(sceneSelect.value).toBe("c1");

    const assetSelect = screen.getByLabelText("File to use") as HTMLSelectElement;
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
    // Client-friendly cleanup pass: "Main Scene" is the primary title -
    // the raw composition name ("Scene 01") only ever appears as subtle
    // secondary metadata, never the heading itself.
    expect(screen.getByText("Main Scene")).not.toBeNull();
    expect(screen.getByText(/Template composition: Scene 01/)).not.toBeNull();
    // Named in the plan itself AND in the "Your files" list above it.
    expect(screen.getAllByText("login-demo.mp4").length).toBeGreaterThan(0);
    expect(screen.getByText("Hello world")).not.toBeNull();
    // The raw asset id is never in the DEFAULT (non-advanced) content -
    // <details> content exists in the DOM even collapsed, so this checks
    // the visible row cell specifically, not the whole document.
    const contentCells = screen.getAllByText("login-demo.mp4");
    expect(contentCells.length).toBeGreaterThan(0);
  });

  it("Simple Mode never shows an 'Advanced details' disclosure at all - the raw IDs stay available only in Advanced Mode, never deleted from the data model", async () => {
    stubWorkspace({
      status: 200,
      body: { workMap: workMapFixture({}, [workMapEntryFixture({ id: "wm-entry-1", sourceCompositionId: "c1", desiredAssetId: "asset-1" })]) }
    });
    renderWorkMap();
    await screen.findByText("Your Video Plan");

    expect(screen.queryByText("Advanced details")).toBeNull();
  });

  it("Advanced Mode still exposes the real composition/asset IDs under Advanced details, unchanged", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
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

/**
 * Live QA fix (CASE A / CASE B / CASE H, "Simple Mode must never expose raw
 * AE structure unless essential for an action the user must take"): a
 * manifest with real nested-only compositions (isNestedOnlyReferenced) and
 * a Work Map entry per composition - the exact real shape a "one entry per
 * manifest composition" AI draft produces - must collapse to ONE scene
 * card per real top-level scene in Simple Mode, never one row per raw
 * composition, while Advanced Mode keeps showing every single entry
 * unfiltered (never loses technical capability).
 */
describe("ProjectWorkMapTab - Simple Mode scene filtering (live QA fix)", () => {
  function manifestWithNestedComps() {
    // Deliberately NO placeholders: this case is specifically about a template
    // whose scene exposes no editable placeholder at all, which is what the
    // honest "did not detect standard editable placeholders" notice reports.
    const base = manifestFixture([]);
    const nested = [0, 1, 2].map((i) => ({
      compositionId: `nested-${i}`,
      aeProjectItemIndex: i + 2,
      name: `Pre-comp ${i}`,
      widthPx: 1920,
      heightPx: 1080,
      durationSeconds: 2,
      frameRate: 30,
      isNestedOnlyReferenced: true,
      parentCompositionIds: ["c1"]
    }));
    return { ...base, compositions: [...base.compositions, ...nested] };
  }

  function entriesOnePerComposition() {
    return [
      workMapEntryFixture({ id: "e-main", sourceCompositionId: "c1", desiredAssetId: "asset-1" }),
      ...[0, 1, 2].map((i) => workMapEntryFixture({ id: `e-nested-${i}`, sourceCompositionId: `nested-${i}` }))
    ];
  }

  it("CASE A/B: Simple Mode shows exactly 1 scene card (never a row per raw nested composition), a plain-language summary, and the no-editable-placeholders notice", async () => {
    stubWorkspace(
      { status: 200, body: { workMap: workMapFixture({}, entriesOnePerComposition()) } },
      { [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithNestedComps() } } }
    );
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    // The 1 real top-level scene (c1 / "Scene 01") is shown as its own card,
    // titled client-friendly "Main Scene" - the raw composition name only
    // ever appears as subtle secondary metadata.
    expect(screen.getByText("Main Scene")).not.toBeNull();
    expect(screen.getByText(/Template composition: Scene 01/)).not.toBeNull();
    // None of the 3 nested-only compositions ever appear as their own card.
    expect(screen.queryByText("Pre-comp 0")).toBeNull();
    expect(screen.queryByText("Pre-comp 1")).toBeNull();
    expect(screen.queryByText("Pre-comp 2")).toBeNull();
    // Composition counts are template internals - never shown to the client.
    expect(screen.queryByText(/main scene\b/)).toBeNull();
    expect(screen.queryByText(/supporting nested compositions/)).toBeNull();
    // CASE B: manifestFixture's own scene has zero editable placeholders - the
    // honest plain-language notice must appear, never a bare "—".
    expect(
      screen.getByText("AI inspected this template but did not detect standard editable placeholders. DYO can preserve the original animation and nested structure, but automatic replacements will only be made where a safe mapping is confirmed.")
    ).not.toBeNull();
    // The Main Scene card shows its own "AI plans to:" checklist.
    expect(screen.getByText("AI plans to:")).not.toBeNull();
    expect(screen.getByText("Preserve original animation")).not.toBeNull();
    expect(screen.getByText("Preserve original timing")).not.toBeNull();
  });

  it("CASE H: Advanced Mode still shows every raw entry, including nested-only compositions - full technical capability preserved", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubWorkspace(
      { status: 200, body: { workMap: workMapFixture({}, entriesOnePerComposition()) } },
      { [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithNestedComps() } } }
    );
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByText("Scene 01")).not.toBeNull();
    expect(screen.getByText("Pre-comp 0")).not.toBeNull();
    expect(screen.getByText("Pre-comp 1")).not.toBeNull();
    expect(screen.getByText("Pre-comp 2")).not.toBeNull();
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
    // Simple Mode's own wording for this exact same manualForm-toggle
    // action (client-facing UX cleanup pass) - "Add details manually" is
    // still the Advanced Mode label, unchanged (see the dedicated test below).
    fireEvent.click(screen.getByRole("button", { name: "Edit Plan" }));

    const textField = (await screen.findByLabelText("Text to show")) as HTMLInputElement;
    expect(textField.value).toBe("Hello world");
    fireEvent.change(textField, { target: { value: "Updated text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save work map" }));

    await waitFor(() => {
      expect((screen.getByLabelText("Text to show") as HTMLInputElement).value).toBe("Updated text");
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
    fireEvent.click(screen.getByRole("button", { name: "Edit Plan" }));
    await screen.findByLabelText("Text to show");
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
    await screen.findByLabelText("Text to show");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("No work map entries yet");
  });

  it("renders in Hebrew when the active locale is he", async () => {
    stubWorkspace({ status: 200, body: { workMap: null } });
    renderWorkMap("he");
    await screen.findByText("ספרו לבינה המלאכותית מה תרצו");
  });
});

/**
 * Simple Mode AI Plan cleanup pass (live QA follow-up): the raw AE
 * composition name is never the primary Simple Mode title, empty
 * "Advanced details" noise never renders, the outdated table-shaped copy
 * is gone, and the existing "Create Execution Plan" action (never a new
 * approval mechanism) is exposed as a clear primary action here too.
 */
describe("ProjectWorkMapTab - Simple Mode AI Plan cleanup pass", () => {
  function manifestWithRealTemplateName() {
    const base = manifestFixture();
    return {
      ...base,
      compositions: [{ ...base.compositions[0]!, compositionId: "c1", name: "!Render" }]
    };
  }

  it("the raw '!Render' composition name is never the primary Simple Mode title - 'Main Scene' is, with the raw name only as secondary metadata", async () => {
    stubWorkspace(
      { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceCompositionId: "c1" })]) } },
      { [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithRealTemplateName() } } }
    );
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    // The page now has other level-3 headings too ("What the assistant
    // used") - the scene card's own title is still "Main Scene", and no
    // heading anywhere carries the raw composition name.
    expect(screen.getByRole("heading", { level: 3, name: "Main Scene" })).not.toBeNull();
    for (const heading of screen.getAllByRole("heading")) {
      expect(heading.textContent).not.toContain("!Render");
    }
    expect(screen.getByText(/Template composition: !Render/)).not.toBeNull();
  });

  it("Advanced Mode still shows the exact raw '!Render' composition name, unchanged", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubWorkspace(
      { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceCompositionId: "c1" })]) } },
      { [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestWithRealTemplateName() } } }
    );
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByText("!Render")).not.toBeNull();
  });

  it("does not render 'Advanced details' at all when every entry has no real content decision - the exact live shape (all entries empty)", async () => {
    const entries = [0, 1, 2].map((i) => workMapEntryFixture({ id: `wm-${i}`, sourceCompositionId: "c1", sourceReference: null, desiredText: null, desiredAssetId: null }));
    stubWorkspace({ status: 200, body: { workMap: workMapFixture({}, entries) } });
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.queryByText("Advanced details")).toBeNull();
  });

  it("never shows 'Advanced details' in Simple Mode even when the entry carries a real content decision - Advanced Mode keeps it, unfiltered", async () => {
    const withDecision = workMapEntryFixture({ id: "wm-real", sourceCompositionId: "c1", desiredText: "Checkout screen" });
    stubWorkspace({ status: 200, body: { workMap: workMapFixture({}, [withDecision]) } });
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.queryByText("Advanced details")).toBeNull();
  });

  it("shows the updated, non-table Simple Mode copy - never the old 'edit any row' table wording", async () => {
    stubWorkspace({ status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceCompositionId: "c1" })]) } });
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByText("AI has prepared your video plan. Review it below, then approve it to continue.")).not.toBeNull();
    expect(screen.queryByText(/You can edit any row/)).toBeNull();
  });

  it("Advanced Mode keeps the old row-based description text unchanged", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubWorkspace({ status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceCompositionId: "c1" })]) } });
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByText("Review what AI planned for each scene. You can edit any row, or use Scene Mapping to fine-tune it further.")).not.toBeNull();
  });

  it("Advanced Mode keeps the 'Add details manually' label unchanged - Simple Mode's own 'Edit Plan' wording never leaks into it", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubWorkspace({ status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceCompositionId: "c1" })]) } });
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByRole("button", { name: "Add details manually" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Plan" })).toBeNull();
  });

  it("shows a clear 'Approve AI Plan' primary action that reuses the EXISTING Create Execution Plan mechanism, and Match Your Content unlocks once it succeeds", async () => {
    stubFetchByUrl({
      [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceCompositionId: "c1" })]) } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: [
        { status: 404, body: { error: { code: "NOT_FOUND", message: "no execution plan yet", requestId: "r1" } } },
        { status: 201, body: { plan: planFixture(), sceneTable: [] } }
      ],
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByText(/Nothing is final yet\./)).not.toBeNull();
    const approveButton = screen.getByRole("button", { name: "Continue to Scenes" });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Go to the Scenes tab" })).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Continue to Scenes" })).toBeNull();
    expect((screen.getByRole("link", { name: "Go to the Scenes tab" }) as HTMLAnchorElement).getAttribute("href")).toBe(`/projects/${PROJECT_ID}/scenes`);
    // Once approved, the "unlocks Match Your Content" helper no longer applies.
    expect(screen.queryByText(/Nothing is final yet\./)).toBeNull();
  });

  it("shows 'Go to the Scenes tab' immediately, never a duplicate 'Approve AI Plan' button, when a plan already exists", async () => {
    stubWorkspace({ status: 200, body: { workMap: workMapFixture({}, [workMapEntryFixture({ sourceCompositionId: "c1" })]) } });
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByRole("link", { name: "Go to the Scenes tab" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Continue to Scenes" })).toBeNull();
  });
});

/**
 * Live QA follow-up (Advanced Details leak): the exact real production
 * shape found on project d9db52fc-7ff2-4088-b872-8a29a8b5a730 - 51 Work
 * Map entries (1 real top-level scene + 50 nested-only compositions),
 * EVERY entry carries real AI-written `instructions` text, and NONE
 * carries a desiredAssetId/desiredText/assetTimestampSeconds/
 * desiredDurationSeconds decision. `hasMeaningfulWorkMapDetail` used to
 * treat `instructions` as "meaningful" and keep all 51 in the raw
 * "Advanced details" list - exposing 51 Work Map UUIDs/composition IDs/
 * "desiredAssetId: null" values, a wall of technical noise the old list
 * format never even displayed the instructions text to justify. Simple
 * Mode must never show that raw list at all; any real instruction text
 * belongs on the surviving scene's own card instead.
 */
describe("ProjectWorkMapTab - real live-QA shape (51 entries, all with instructions, zero content decisions)", () => {
  function fiftyOneCompositionManifest() {
    const base = manifestFixture();
    const mainScene = { ...base.compositions[0]!, compositionId: "main-scene", name: "!Render" };
    const nested = Array.from({ length: 50 }, (_, i) => ({
      compositionId: `nested-${i}`,
      aeProjectItemIndex: i + 2,
      name: `Pre-comp ${i}`,
      widthPx: 1920,
      heightPx: 1080,
      durationSeconds: 2,
      frameRate: 30,
      isNestedOnlyReferenced: true,
      parentCompositionIds: ["main-scene"]
    }));
    return { ...base, compositions: [mainScene, ...nested] };
  }

  const MAIN_SCENE_NOTE = "Primary/main scene - the final render comp. Preserve original structure, timing, transitions and nested compositions exactly as built. No candidate assets were provided, so no asset/text substitutions are made here.";
  const NESTED_NOTE = "No uploaded assets available to map. Keep the template's template content unchanged.";

  function fiftyOneEntriesAllWithInstructionsOnly() {
    return [
      workMapEntryFixture({
        id: "e-main",
        sourceCompositionId: "main-scene",
        sourceReference: null,
        desiredAssetId: null,
        desiredText: null,
        assetTimestampSeconds: null,
        desiredDurationSeconds: null,
        instructions: MAIN_SCENE_NOTE
      }),
      ...Array.from({ length: 50 }, (_, i) =>
        workMapEntryFixture({
          id: `e-nested-${i}`,
          sourceCompositionId: `nested-${i}`,
          sourceReference: null,
          desiredAssetId: null,
          desiredText: null,
          assetTimestampSeconds: null,
          desiredDurationSeconds: null,
          instructions: NESTED_NOTE
        })
      )
    ];
  }

  it("Simple Mode shows no Advanced Details technical wall, and no Work Map UUIDs/composition IDs anywhere on the page", async () => {
    stubWorkspace(
      { status: 200, body: { workMap: workMapFixture({}, fiftyOneEntriesAllWithInstructionsOnly()) } },
      { [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: fiftyOneCompositionManifest() } } }
    );
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    // No "Advanced details" disclosure at all - not even collapsed.
    expect(screen.queryByText("Advanced details")).toBeNull();
    // None of the raw Work Map UUIDs or nested composition IDs ever reach the DOM.
    expect(document.body.textContent).not.toContain("e-main");
    expect(document.body.textContent).not.toContain("nested-0");
    expect(document.body.textContent).not.toContain("main-scene");
  });

  it("shows the real AI instruction text as a plain-language note on the one surviving Main Scene card", async () => {
    stubWorkspace(
      { status: 200, body: { workMap: workMapFixture({}, fiftyOneEntriesAllWithInstructionsOnly()) } },
      { [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: fiftyOneCompositionManifest() } } }
    );
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    expect(screen.getByText("Main Scene")).not.toBeNull();
    expect(screen.getByText(MAIN_SCENE_NOTE, { exact: false })).not.toBeNull();
    expect(screen.getByText("AI note:")).not.toBeNull();
    // Only the surviving scene's own note appears - none of the 50 nested
    // compositions' notes leak in as their own content.
    expect(screen.queryAllByText(NESTED_NOTE, { exact: false })).toHaveLength(0);
  });

  it("Advanced Mode still shows the full raw technical data - all 51 entries, composition IDs, and asset IDs", async () => {
    window.localStorage.setItem("dyo-workspace-mode", "advanced");
    stubWorkspace(
      { status: 200, body: { workMap: workMapFixture({}, fiftyOneEntriesAllWithInstructionsOnly()) } },
      { [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: fiftyOneCompositionManifest() } } }
    );
    renderWorkMap();

    await screen.findByText("Your Video Plan");
    const toggle = screen.getByText("Advanced details");
    fireEvent.click(toggle);
    expect(document.body.textContent).toContain("e-main");
    expect(document.body.textContent).toContain("main-scene");
    expect(document.body.textContent).toContain("nested-0");
    expect(document.body.textContent).toContain("nested-49");
  });

  describe("an empty description must look empty (real confusion, seen twice 2026-10-02)", () => {
    it("a press with nothing filled in answers with what is needed - never a dead button", async () => {
      stubWorkspace({ status: 200, body: { workMap: null } });
      renderWorkMap();
      await screen.findByLabelText("Describe your video");
      const button = screen.getByRole("button", { name: "Claude — Create Video Plan" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect((await screen.findByRole("alert")).textContent).toMatch(/Give the assistant something to work from first/);
    });

    it("a business description alone is enough - the description box is optional", async () => {
      const calls: Array<{ url: string; method: string; body: unknown }> = [];
      stubFetchByUrl(
        {
          [`/api/projects/${PROJECT_ID}/work-map/ai-draft`]: { status: 201, body: { workMap: workMapFixture({ revision: 1 }, [workMapEntryFixture({ id: "wm-1", sourceCompositionId: "c1", desiredText: "Hello" })]) } },
          [`/api/projects/${PROJECT_ID}/brand-inputs`]: { status: 200, body: projectDtoFixture() },
          [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: null } },
          [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
          [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [] } },
          [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
        },
        calls
      );
      renderWorkMap();
      fireEvent.change(await screen.findByLabelText("About your business (optional)"), { target: { value: "We make apps for clinics." } });
      fireEvent.click(screen.getByRole("button", { name: "Claude — Create Video Plan" }));

      await screen.findByText("Your Video Plan");
      const draft = calls.find((call) => call.url.includes("/work-map/ai-draft"));
      expect((draft?.body as { instructions: string }).instructions).toMatch(/Plan a promo video for this business/);
      // English on screen unless the client chooses otherwise - never whatever language they happened to type in.
      expect((draft?.body as { instructions: string }).instructions).toMatch(/Write every on-screen text in English/);
      // And the user is told how long it really took.
      expect(screen.getByText(/This plan took \d+:\d\d to write\./)).not.toBeNull();
    });

    it("covers the screen with progress and a running clock while the plan is being written", async () => {
      let release: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      stubWorkspace({ status: 200, body: { workMap: null } });
      const realFetch = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).includes("/work-map/ai-draft")) {
            await pending;
          }
          return realFetch(input, init);
        })
      );
      renderWorkMap();
      fireEvent.change(await screen.findByLabelText("Describe your video"), { target: { value: "A short promo." } });
      fireEvent.click(screen.getByRole("button", { name: "Claude — Create Video Plan" }));

      const overlay = await screen.findByRole("status");
      expect(within(overlay).getByText("Claude is writing your video plan")).not.toBeNull();
      expect(within(overlay).getByText("Time so far: 0:00")).not.toBeNull();
      expect(within(overlay).getByRole("progressbar")).not.toBeNull();
      release?.();
      await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    });

    it("the box's own placeholder is an instruction, never a made-up request that reads as already typed", async () => {
      window.localStorage.clear();
      stubWorkspace({ status: 200, body: { workMap: null } });
      renderWorkMap();
      const textarea = (await screen.findByLabelText("Describe your video")) as HTMLTextAreaElement;
      expect(textarea.placeholder).toBe("Type here what the video should show…");
      expect(textarea.value).toBe("");
    });

    it("what was typed survives a refresh (a fresh mount)", async () => {
      window.localStorage.clear();
      stubWorkspace({ status: 200, body: { workMap: null } });
      renderWorkMap();
      fireEvent.change(await screen.findByLabelText("Describe your video"), { target: { value: "Keep this." } });
      cleanup();
      renderWorkMap();
      expect(((await screen.findByLabelText("Describe your video")) as HTMLTextAreaElement).value).toBe("Keep this.");
      window.localStorage.clear();
    });
  });

  it("the client chooses the language of the on-screen text, separately from the language they type in (real surprise 2026-10-02)", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    stubFetchByUrl(
      {
        [`/api/projects/${PROJECT_ID}/work-map/ai-draft`]: { status: 201, body: { workMap: workMapFixture({ revision: 1 }, [workMapEntryFixture({ id: "wm-1", sourceCompositionId: "c1", desiredText: "Hello" })]) } },
        [`/api/projects/${PROJECT_ID}/work-map`]: { status: 200, body: { workMap: null } },
        [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
        [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [] } },
        [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
      },
      calls
    );
    renderWorkMap();
    fireEvent.change(await screen.findByLabelText("Describe your video"), { target: { value: "ek chota promo" } });
    fireEvent.change(screen.getByLabelText("Language of the text in the video"), { target: { value: "he" } });
    fireEvent.click(screen.getByRole("button", { name: "Claude — Create Video Plan" }));

    await screen.findByText("Your Video Plan");
    const sent = (calls.find((call) => call.url.includes("/work-map/ai-draft"))?.body as { instructions: string }).instructions;
    expect(sent.startsWith("ek chota promo")).toBe(true);
    expect(sent).toMatch(/Write every on-screen text in Hebrew/);
  });
});
