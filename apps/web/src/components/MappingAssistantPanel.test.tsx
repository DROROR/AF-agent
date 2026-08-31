// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MappingAssistantPanel } from "./MappingAssistantPanel";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  manifestFixture,
  mappingSuggestionFixture,
  planFixture,
  projectDtoFixture,
  sceneFixture,
  stubFetchByUrl
} from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mappingFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Hero Image",
    placeholderClassification: { value: null, source: "MANIFEST", evidence: ["unknown"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function stubWorkspace(
  mappingSuggestionsHandler: Parameters<typeof stubFetchByUrl>[0][string],
  assetsHandler: Parameters<typeof stubFetchByUrl>[0][string] = { status: 200, body: { assets: [] } },
  scenes = [sceneFixture({ id: "scene-1", compositionName: "Scene 01", mappings: [mappingFixture()] })],
  extra: Record<string, Parameters<typeof stubFetchByUrl>[0][string]> = {}
): void {
  stubFetchByUrl({
    "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
    [`/api/projects/${PROJECT_ID}/mapping-suggestions`]: mappingSuggestionsHandler,
    [`/api/projects/${PROJECT_ID}/assets`]: assetsHandler,
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } },
    ...extra
  });
}

function renderPanel(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <MappingAssistantPanel />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

/**
 * "Improve AI accuracy" (offline-safe-control-plane phase, sections 2/3) -
 * dispatches via the SAME safe scenePlanId-only intent EXECUTE_FRAME/RENDER
 * already use (see resolve-inspect-scene-evidence-dispatch.ts). Never
 * exposes INSPECT_SCENE_EVIDENCE, sourceProjectPath, or any Worker
 * operation code to the user - and never auto-regenerates suggestions.
 *
 * Placed BEFORE the main describe block below (whose last test switches the
 * shared jsdom document's lang to "he" via renderWithLocale and is never
 * reset - see that file's own doc comment) so these tests always run while
 * the locale is still the default "en", matching every other test file's
 * own "Hebrew test goes last" convention.
 */
describe("MappingAssistantPanel - Improve AI accuracy", () => {
  it("shows the button for a scene whose evidence is NOT_INSPECTED, and dispatches the real minimal-intent job when a worker is available", async () => {
    stubWorkspace(
      { status: 200, body: { suggestions: [mappingSuggestionFixture()], aiAvailable: false, sceneEvidenceAvailability: {} } },
      { status: 200, body: { assets: [] } },
      [sceneFixture({ id: "scene-1", compositionName: "Scene 01", mappings: [mappingFixture()] })],
      {
        "/api/dashboard/status": {
          status: 200,
          body: {
            api: "ok",
            database: "ok",
            workers: [{ workerId: "11111111-1111-1111-1111-111111111111", name: "Client PC", status: "ONLINE", aeStatus: "ONLINE", mcpStatus: "ONLINE", capabilities: ["INSPECT_SCENE_EVIDENCE"], currentJobId: null, maxConcurrency: 1, lastHeartbeatAt: new Date().toISOString() }]
          }
        },
        "/api/jobs": {
          status: 201,
          body: { jobId: "22222222-2222-2222-2222-222222222222", workerId: "11111111-1111-1111-1111-111111111111", operation: "INSPECT_SCENE_EVIDENCE", status: "QUEUED", createdAt: new Date().toISOString() }
        }
      }
    );
    renderPanel();
    await screen.findByText("Scene evidence: Not inspected");
    fireEvent.click(screen.getByRole("button", { name: "Improve AI accuracy" }));

    await screen.findByText(/Sent to your editing computer/);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const dispatchCall = fetchMock.mock.calls.find((call: unknown[]) => call[0] === "/api/jobs");
    const [, init] = dispatchCall as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ operation: "INSPECT_SCENE_EVIDENCE", workerId: "11111111-1111-1111-1111-111111111111", projectId: PROJECT_ID, scenePlanId: "scene-1" });
  });

  it("shows the plain offline message and never dispatches when no compatible worker is online - no internal operation codes or paths ever shown", async () => {
    stubWorkspace(
      { status: 200, body: { suggestions: [mappingSuggestionFixture()], aiAvailable: false, sceneEvidenceAvailability: {} } },
      { status: 200, body: { assets: [] } },
      [sceneFixture({ id: "scene-1", compositionName: "Scene 01", mappings: [mappingFixture()] })],
      { "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } } }
    );
    renderPanel();
    await screen.findByText("Scene evidence: Not inspected");
    fireEvent.click(screen.getByRole("button", { name: "Improve AI accuracy" }));

    await screen.findByText("Your editing computer is offline. Turn it on to improve AI accuracy.");
    expect(screen.queryByText(/INSPECT_SCENE_EVIDENCE/)).toBeNull();
    expect(screen.queryByText(/sourceProjectPath/)).toBeNull();
  });

  it("never shows the button once evidence is already available for a scene", async () => {
    stubWorkspace(
      { status: 200, body: { suggestions: [mappingSuggestionFixture()], aiAvailable: false, sceneEvidenceAvailability: { "comp-1": "AVAILABLE" } } },
      { status: 200, body: { assets: [] } }
    );
    renderPanel();
    await screen.findByText(/Evidence inspected/);
    expect(screen.queryByRole("button", { name: "Improve AI accuracy" })).toBeNull();
  });
});

describe("MappingAssistantPanel", () => {
  it('shows the honest empty state "No suggestions yet" when there are none - never a fake suggestion', async () => {
    stubWorkspace({ status: 200, body: { suggestions: [], aiAvailable: false, sceneEvidenceAvailability: {} } });
    renderPanel();
    await screen.findByText("No suggestions yet");
    screen.getByText("AI: not configured (deterministic only)");
  });

  it("renders a real DETERMINISTIC suggestion under its own scene heading, with its evidence/provenance visible under 'Why this suggestion?'", async () => {
    stubWorkspace({
      status: 200,
      body: { suggestions: [mappingSuggestionFixture({ suggestedText: "Hello world" })], aiAvailable: false, sceneEvidenceAvailability: {} }
    });
    renderPanel();
    await screen.findByText("Scene 01");
    screen.getByText("Hero Image");
    screen.getByText("Deterministic");
    screen.getByText("High"); // confidence 1 -> plain-language "High", not a raw percentage, in the default view
    screen.getByText("Hello world");
    screen.getByText("User intent");
    screen.getByText('Work Map entry for this scene names asset "Client logo"');
    // The exact percentage is still available, just under the disclosure - never deleted.
    screen.getByText("Confidence: 100%");
  });

  it("renders a real AI suggestion distinctly from a deterministic one, and reports AI as available", async () => {
    stubWorkspace({
      status: 200,
      body: {
        suggestions: [
          mappingSuggestionFixture({
            id: "suggestion-ai",
            source: "AI",
            reasoning: "inferred from context",
            evidenceRefs: [{ kind: "AI_INFERENCE", summary: "low-confidence guess" }],
            confidence: 0.6,
            requiresHumanReview: true
          })
        ],
        aiAvailable: true,
        sceneEvidenceAvailability: {}
      }
    });
    renderPanel();
    await screen.findByText("AI Suggested");
    screen.getByText("AI: available");
    screen.getByText("Medium"); // 0.6 falls in the [0.5, 0.75) "Medium" tier
    screen.getByText("Confidence: 60%");
    screen.getByText("AI inference");
  });

  it("a confidence at or above 0.75 shows as High - the exact same threshold generate-mapping-suggestions.ts already enforces server-side", async () => {
    stubWorkspace({
      status: 200,
      body: { suggestions: [mappingSuggestionFixture({ confidence: 0.75 })], aiAvailable: false, sceneEvidenceAvailability: {} }
    });
    renderPanel();
    await screen.findByText("High");
  });

  it("a real 'needs review' suggestion (confidence below 0.5, e.g. from the server-side safety gate) shows the plain 'Needs review' label - never a raw low percentage as the primary signal", async () => {
    stubWorkspace({
      status: 200,
      body: {
        suggestions: [
          mappingSuggestionFixture({
            confidence: 0.3,
            suggestedAssetId: null,
            suggestedText: null,
            reasoning: "weak guess based on generic layer name",
            unresolvedReason: "Needs review - not enough evidence for a confident automatic suggestion"
          })
        ],
        aiAvailable: true,
        sceneEvidenceAvailability: {}
      }
    });
    renderPanel();
    await screen.findByText("Needs review");
    screen.getByText(/Needs review - not enough evidence/);
  });

  it("never hides uncertainty - a conflicting suggestion shows its unresolvedReason and the Work Map conflict warning", async () => {
    stubWorkspace({
      status: 200,
      body: {
        suggestions: [
          mappingSuggestionFixture({
            suggestedAssetId: null,
            conflictsWithWorkMap: true,
            requiresHumanReview: true,
            reasoning: null,
            unresolvedReason: "Work Map references an asset that no longer exists in this project's Asset Catalog - upload it again or update the Work Map"
          })
        ],
        aiAvailable: false,
        sceneEvidenceAvailability: {}
      }
    });
    renderPanel();
    await screen.findByText(/Work Map references an asset that no longer exists/);
    screen.getByText("This conflicts with a Work Map entry - review carefully before accepting.");
  });

  it("shows the real suggested asset's label, never its raw id", async () => {
    stubWorkspace(
      { status: 200, body: { suggestions: [mappingSuggestionFixture({ suggestedAssetId: "asset-1" })], aiAvailable: false, sceneEvidenceAvailability: {} } },
      {
        status: 200,
        body: {
          assets: [
            {
              id: "asset-1",
              projectId: PROJECT_ID,
              originalFilename: "logo.png",
              storageKey: `${PROJECT_ID}/asset-1.png`,
              mediaKind: "LOGO",
              mimeType: "image/png",
              byteSize: 10,
              sha256: "a".repeat(64),
              width: null,
              height: null,
              durationSeconds: null,
              label: "Client logo",
              notes: null,
              uploadedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]
        }
      }
    );
    renderPanel();
    await screen.findByText("Client logo");
    expect(screen.queryByText("asset-1")).toBeNull();
  });

  it("accepts a suggestion and removes it from the pending list, showing it as User Confirmed", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/mapping-suggestions`]: [
        { status: 200, body: { suggestions: [mappingSuggestionFixture()], aiAvailable: false, sceneEvidenceAvailability: {} } },
        { status: 200, body: { suggestions: [mappingSuggestionFixture({ status: "ACCEPTED" })], aiAvailable: false, sceneEvidenceAvailability: {} } }
      ],
      [`/api/projects/${PROJECT_ID}/mapping-suggestions/suggestion-1/accept`]: {
        status: 200,
        body: {
          suggestion: mappingSuggestionFixture({ status: "ACCEPTED" }),
          executionPlan: { plan: planFixture({ revision: 2 }, [sceneFixture({ id: "scene-1", compositionName: "Scene 01", mappings: [mappingFixture()] })]), sceneTable: [] }
        }
      },
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderPanel();
    await screen.findByText("Accept");
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(screen.getByText("No suggestions yet")).toBeTruthy());
    screen.getByText("User Confirmed");
  });

  it("rejects a suggestion and leaves it visible as Rejected, never silently removed", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
      [`/api/projects/${PROJECT_ID}/mapping-suggestions`]: [
        { status: 200, body: { suggestions: [mappingSuggestionFixture()], aiAvailable: false, sceneEvidenceAvailability: {} } },
        { status: 200, body: { suggestions: [mappingSuggestionFixture({ status: "REJECTED" })], aiAvailable: false, sceneEvidenceAvailability: {} } }
      ],
      [`/api/projects/${PROJECT_ID}/mapping-suggestions/suggestion-1/reject`]: { status: 200, body: { suggestion: mappingSuggestionFixture({ status: "REJECTED" }) } },
      [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: [] } },
      [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture(), sceneTable: [] } },
      [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
    });
    renderPanel();
    await screen.findByText("Reject");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(screen.getByText("Rejected")).toBeTruthy());
  });

  it("shows an honest per-scene evidence status on the scene group heading - AVAILABLE, STALE, and NOT_INSPECTED are all rendered, never hidden", async () => {
    stubWorkspace({
      status: 200,
      body: { suggestions: [mappingSuggestionFixture()], aiAvailable: false, sceneEvidenceAvailability: { "comp-1": "STALE" } }
    });
    renderPanel();
    await screen.findByText("Scene evidence: Stale (captured against an older version of this project)");
  });

  it("groups multiple suggestions from different scenes under their own scene headings, in the plan's real scene order", async () => {
    const scenes = [
      sceneFixture({ id: "scene-1", compositionName: "Scene 01", sourcePosition: 0, mappings: [mappingFixture({ id: "mapping-1", placeholderName: "Hero Image" })] }),
      sceneFixture({ id: "scene-2", manifestCompositionId: "comp-2", compositionName: "Scene 02", sourcePosition: 1, mappings: [mappingFixture({ id: "mapping-2", placeholderName: "Headline" })] })
    ];
    stubWorkspace(
      {
        status: 200,
        body: {
          suggestions: [
            mappingSuggestionFixture({ id: "s1", scenePlanId: "scene-1", mappingId: "mapping-1" }),
            mappingSuggestionFixture({ id: "s2", scenePlanId: "scene-2", mappingId: "mapping-2" })
          ],
          aiAvailable: false,
          sceneEvidenceAvailability: {}
        }
      },
      { status: 200, body: { assets: [] } },
      scenes
    );
    renderPanel();
    await screen.findByText("Scene 01");
    screen.getByText("Scene 02");
    screen.getByText("Hero Image");
    screen.getByText("Headline");
  });

  it("renders in Hebrew when the active locale is he", async () => {
    stubWorkspace({ status: 200, body: { suggestions: [], aiAvailable: false, sceneEvidenceAvailability: {} } });
    renderWithLocale(
      <DashboardStatusProvider>
        <ProjectWorkspaceProvider projectId={PROJECT_ID}>
          <MappingAssistantPanel />
        </ProjectWorkspaceProvider>
      </DashboardStatusProvider>,
      { locale: "he" }
    );
    await screen.findByText("אין עדיין הצעות");
  });
});
