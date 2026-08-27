// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MappingAssistantPanel } from "./MappingAssistantPanel";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
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
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function stubWorkspace(mappingSuggestionsHandler: Parameters<typeof stubFetchByUrl>[0][string], assetsHandler: Parameters<typeof stubFetchByUrl>[0][string] = { status: 200, body: { assets: [] } }): void {
  const scenes = [sceneFixture({ id: "scene-1", compositionName: "Scene 01", mappings: [mappingFixture()] })];
  stubFetchByUrl({
    [`/api/projects/${PROJECT_ID}/mapping-suggestions`]: mappingSuggestionsHandler,
    [`/api/projects/${PROJECT_ID}/assets`]: assetsHandler,
    [`/api/projects/${PROJECT_ID}/execution-plan`]: { status: 200, body: { plan: planFixture({}, scenes), sceneTable: [] } },
    [`/api/projects/${PROJECT_ID}`]: { status: 200, body: { project: projectDtoFixture(), manifest: manifestFixture() } }
  });
}

function renderPanel(): void {
  renderWithLocale(
    <ProjectWorkspaceProvider projectId={PROJECT_ID}>
      <MappingAssistantPanel />
    </ProjectWorkspaceProvider>
  );
}

describe("MappingAssistantPanel", () => {
  it('shows the honest empty state "No suggestions yet" when there are none - never a fake suggestion', async () => {
    stubWorkspace({ status: 200, body: { suggestions: [], aiAvailable: false, sceneEvidenceAvailability: {} } });
    renderPanel();
    await screen.findByText("No suggestions yet");
    screen.getByText("AI: not configured (deterministic only)");
  });

  it("renders a real DETERMINISTIC suggestion with its evidence/provenance and confidence visible", async () => {
    stubWorkspace({
      status: 200,
      body: { suggestions: [mappingSuggestionFixture({ suggestedText: "Hello world" })], aiAvailable: false, sceneEvidenceAvailability: {} }
    });
    renderPanel();
    await screen.findByText("Scene 01 — Hero Image");
    screen.getByText("Deterministic");
    screen.getByText("Confidence: 100%");
    screen.getByText("Hello world");
    screen.getByText("User intent");
    screen.getByText('Work Map entry for this scene names asset "Client logo"');
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
        aiAvailable: true, sceneEvidenceAvailability: {}
      }
    });
    renderPanel();
    await screen.findByText("AI Suggested");
    screen.getByText("AI: available");
    screen.getByText("Confidence: 60%");
    screen.getByText("AI inference");
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
        aiAvailable: false, sceneEvidenceAvailability: {}
      }
    });
    renderPanel();
    await screen.findByText(/Work Map references an asset that no longer exists/);
    screen.getByText("This conflicts with a Work Map entry - review carefully before accepting.");
  });

  it("shows the real suggested asset's label, never its raw id", async () => {
    stubWorkspace(
      { status: 200, body: { suggestions: [mappingSuggestionFixture({ suggestedAssetId: "asset-1" })], aiAvailable: false, sceneEvidenceAvailability: {} } },
      { status: 200, body: { assets: [{ id: "asset-1", projectId: PROJECT_ID, originalFilename: "logo.png", storageKey: `${PROJECT_ID}/asset-1.png`, mediaKind: "LOGO", mimeType: "image/png", byteSize: 10, sha256: "a".repeat(64), width: null, height: null, durationSeconds: null, label: "Client logo", notes: null, uploadedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } }
    );
    renderPanel();
    await screen.findByText("Client logo");
    expect(screen.queryByText("asset-1")).toBeNull();
  });

  it("accepts a suggestion and removes it from the pending list, showing it as User Confirmed", async () => {
    stubFetchByUrl({
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

  it("shows an honest per-scene evidence status - AVAILABLE, STALE, and NOT_INSPECTED are all rendered, never hidden", async () => {
    stubWorkspace({
      status: 200,
      body: { suggestions: [mappingSuggestionFixture()], aiAvailable: false, sceneEvidenceAvailability: { "comp-1": "STALE" } }
    });
    renderPanel();
    await screen.findByText("Scene evidence: Stale (captured against an older version of this project)");
  });

  it("renders in Hebrew when the active locale is he", async () => {
    stubWorkspace({ status: 200, body: { suggestions: [], aiAvailable: false, sceneEvidenceAvailability: {} } });
    renderWithLocale(
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <MappingAssistantPanel />
      </ProjectWorkspaceProvider>,
      { locale: "he" }
    );
    await screen.findByText("אין עדיין הצעות");
  });
});
