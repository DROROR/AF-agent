// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimpleScenesView } from "./SimpleScenesView";
import { ProjectWorkspaceProvider } from "./ProjectWorkspaceProvider";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { renderWithLocale } from "../test-utils/render-with-locale";
import {
  PROJECT_ID,
  assetFixture,
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
    humanLayerIndex: null,
    humanNestedTarget: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

/** A manifest with one real scene (comp-parent) and one nested-only helper composition (comp-nested) attached to it - the exact shape section B's real-scene grouping must collapse into a single card. */
function manifestWithNested() {
  const base = manifestFixture();
  return {
    ...base,
    compositions: [
      {
        compositionId: "comp-parent",
        aeProjectItemIndex: 1,
        name: "App Features",
        widthPx: 1920,
        heightPx: 1080,
        durationSeconds: 4,
        frameRate: 30,
        isNestedOnlyReferenced: false,
        parentCompositionIds: []
      },
      {
        compositionId: "comp-nested",
        aeProjectItemIndex: 2,
        name: "Phone Frame",
        widthPx: 1080,
        heightPx: 1920,
        durationSeconds: 4,
        frameRate: 30,
        isNestedOnlyReferenced: true,
        parentCompositionIds: ["comp-parent"]
      }
    ]
  };
}

function stubWorkspace(options: {
  suggestions?: unknown[];
  assets?: unknown[];
  scenes?: ReturnType<typeof sceneFixture>[];
  manifest?: ReturnType<typeof manifestFixture>;
  extra?: Record<string, Parameters<typeof stubFetchByUrl>[0][string]>;
}): void {
  const scenes = options.scenes ?? [
    sceneFixture({
      id: "scene-parent",
      manifestCompositionId: "comp-parent",
      compositionName: "App Features",
      mappings: [mappingFixture()]
    }),
    sceneFixture({
      id: "scene-nested",
      manifestCompositionId: "comp-nested",
      compositionName: "Phone Frame",
      mappings: []
    })
  ];
  stubFetchByUrl({
    "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
    [`/api/projects/${PROJECT_ID}/mapping-suggestions`]: {
      status: 200,
      body: {
        suggestions: options.suggestions ?? [],
        aiAvailable: false,
        sceneEvidenceAvailability: {}
      }
    },
    [`/api/projects/${PROJECT_ID}/assets`]: { status: 200, body: { assets: options.assets ?? [] } },
    [`/api/projects/${PROJECT_ID}/execution-plan`]: {
      status: 200,
      body: { plan: planFixture({}, scenes), sceneTable: [] }
    },
    [`/api/projects/${PROJECT_ID}`]: {
      status: 200,
      body: { project: projectDtoFixture(), manifest: options.manifest ?? manifestWithNested() }
    },
    ...(options.extra ?? {})
  });
}

function renderView(): void {
  renderWithLocale(
    <DashboardStatusProvider>
      <ProjectWorkspaceProvider projectId={PROJECT_ID}>
        <SimpleScenesView />
      </ProjectWorkspaceProvider>
    </DashboardStatusProvider>
  );
}

describe("SimpleScenesView - real-scene cards (client-facing UX redesign)", () => {
  it("shows exactly one card for a real scene and its nested-only helper composition - never a separate card for the nested comp", async () => {
    stubWorkspace({});
    renderView();
    await screen.findByRole("heading", { name: "App Features" });
    // "Phone Frame" (the nested-only composition's own name) never appears
    // as its own heading - only as an Advanced-details fact under the real
    // scene's card once expanded.
    expect(screen.queryByRole("heading", { name: "Phone Frame" })).toBeNull();
  });

  it("hides technical facts (the raw manifest composition id) behind a closed Advanced details disclosure by default", async () => {
    stubWorkspace({});
    renderView();
    await screen.findByRole("heading", { name: "App Features" });
    const details = screen.getByText("comp-parent").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("Advanced details"));
    expect(details.open).toBe(true);
  });

  it("shows a genuine PENDING content suggestion as a visual review item with Keep Original / Use Suggestion actions", async () => {
    stubWorkspace({
      suggestions: [
        mappingSuggestionFixture({
          scenePlanId: "scene-parent",
          mappingId: "mapping-1",
          suggestedText: "New headline"
        })
      ]
    });
    renderView();
    await screen.findByText('Claude suggests: "New headline"');
    expect(screen.queryByRole("button", { name: "Keep original" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Use suggestion" })).not.toBeNull();
  });

  it("never renders a RESOLVED (structural, no-op) suggestion as a review item - only genuinely PENDING content decisions reach this view", async () => {
    stubWorkspace({
      suggestions: [
        mappingSuggestionFixture({
          id: "s-resolved",
          scenePlanId: "scene-parent",
          status: "RESOLVED",
          suggestedText: null
        })
      ]
    });
    renderView();
    await screen.findByRole("heading", { name: "App Features" });
    expect(screen.queryByText("Needs your review")).toBeNull();
  });

  it("shows Original (AE) and Planned previews side by side when both exist - Before/After (point M.4)", async () => {
    const capturedAt = new Date().toISOString();
    stubWorkspace({
      assets: [assetFixture({ id: "asset-1", originalFilename: "checkout.mp4", mediaKind: "VIDEO" })],
      scenes: [
        sceneFixture({
          id: "scene-parent",
          manifestCompositionId: "comp-parent",
          compositionName: "App Features",
          mappings: [mappingFixture({ selectedAssetId: "asset-1", selectedAssetType: "video", text: "Track every workout" })]
        }),
        sceneFixture({ id: "scene-nested", manifestCompositionId: "comp-nested", compositionName: "Phone Frame", mappings: [] })
      ],
      extra: {
        [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-parent/preview-status`]: {
          status: 200,
          body: {
            preview: {
              id: "22222222-2222-2222-2222-222222222222",
              projectId: PROJECT_ID,
              manifestCompositionId: "comp-parent",
              sourceProjectSha256: "a".repeat(64),
              filename: "scene-preview-App_Features.png",
              mimeType: "image/png",
              byteSize: 42,
              capturedAt,
              createdAt: capturedAt
            }
          }
        }
      }
    });
    renderView();
    await screen.findByText("After Effects preview");
    expect(screen.queryByText("Planned preview — not yet rendered in After Effects")).not.toBeNull();
    expect(screen.getAllByText("Track every workout").length).toBeGreaterThan(0);
  });

  it("automatically dispatches the real minimal-intent job on page load (no click needed) and auto-updates to the captured preview once ready - no manual refresh, no Jobs page", async () => {
    const capturedAt = new Date().toISOString();
    stubWorkspace({
      extra: {
        "/api/dashboard/status": {
          status: 200,
          body: {
            api: "ok",
            database: "ok",
            workers: [
              {
                workerId: "11111111-1111-1111-1111-111111111111",
                name: "Client PC",
                status: "ONLINE",
                aeStatus: "ONLINE",
                mcpStatus: "ONLINE",
                aeAvailability: "ONLINE",
                mcpAvailability: "ONLINE",
                capabilities: ["INSPECT_SCENE_EVIDENCE"],
                currentJobId: null,
                maxConcurrency: 1,
                lastHeartbeatAt: new Date().toISOString()
              }
            ]
          }
        },
        [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-parent/preview-status`]: [
          { status: 200, body: { preview: null } },
          {
            status: 200,
            body: {
              preview: {
                id: "22222222-2222-2222-2222-222222222222",
                projectId: PROJECT_ID,
                manifestCompositionId: "comp-parent",
                sourceProjectSha256: "a".repeat(64),
                filename: "scene-preview-App_Features.png",
                mimeType: "image/png",
                byteSize: 42,
                capturedAt,
                createdAt: capturedAt
              }
            }
          }
        ],
        "/api/jobs": {
          status: 201,
          body: {
            jobId: "33333333-3333-3333-3333-333333333333",
            workerId: "11111111-1111-1111-1111-111111111111",
            operation: "INSPECT_SCENE_EVIDENCE",
            status: "QUEUED",
            createdAt: new Date().toISOString()
          }
        }
      }
    });
    renderView();
    await screen.findByRole("heading", { name: "App Features" });

    await screen.findByText("Preview generating…", {}, { timeout: 5000 });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const dispatchCall = fetchMock.mock.calls.find((call: unknown[]) => call[0] === "/api/jobs");
    const [, init] = dispatchCall as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      operation: "INSPECT_SCENE_EVIDENCE",
      workerId: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
      scenePlanId: "scene-parent"
    });

    await waitFor(
      () => {
        expect(screen.queryByText("After Effects preview")).not.toBeNull();
      },
      { timeout: 10_000 }
    );
  }, 20_000);

  it("final MVP polish item 2 (preview freshness): Approve Scenes stays disabled with a plain 'updating previews' hint while a scene's real preview is stale (captured BEFORE a mapping change) - a stale preview is never treated as current for approval", async () => {
    const staleCapturedAt = new Date(Date.now() - 60_000).toISOString(); // captured a minute ago
    const scenes = [
      sceneFixture({
        id: "scene-parent",
        manifestCompositionId: "comp-parent",
        compositionName: "App Features",
        mappings: [mappingFixture()],
        approvalState: "READY_FOR_APPROVAL",
        unresolvedReasons: [],
        updatedAt: new Date().toISOString() // NOW - after the stale preview below was captured
      }),
      sceneFixture({
        id: "scene-nested",
        manifestCompositionId: "comp-nested",
        compositionName: "Phone Frame",
        mappings: [],
        approvalState: "READY_FOR_APPROVAL",
        unresolvedReasons: [],
        updatedAt: new Date(0).toISOString()
      })
    ];
    stubWorkspace({
      scenes,
      extra: {
        // No worker online - the auto-regeneration this staleness would
        // otherwise trigger never resolves, so the disabled state is
        // observable rather than immediately self-healing mid-test.
        "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } },
        [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-parent/preview-status`]: {
          status: 200,
          body: {
            preview: {
              id: "22222222-2222-2222-2222-222222222222",
              projectId: PROJECT_ID,
              manifestCompositionId: "comp-parent",
              sourceProjectSha256: "a".repeat(64),
              filename: "scene-preview-App_Features.png",
              mimeType: "image/png",
              byteSize: 42,
              capturedAt: staleCapturedAt,
              createdAt: staleCapturedAt
            }
          }
        },
        [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-nested/preview-status`]: { status: 200, body: { preview: null } }
      }
    });
    renderView();
    await screen.findByRole("heading", { name: "App Features" });

    await screen.findByText("This scene changed since this preview was captured - it may no longer match. Generate a new preview to see the current result.");
    await screen.findByText("Updating previews for scenes you just changed - this only takes a moment, no action needed.");
    expect((screen.getByRole("button", { name: "Approve Scenes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it(
    "queues previews across multiple real scenes and dispatches them ONE AT A TIME - never a second concurrent dispatch, respecting Worker maxConcurrency=1 (section 6)",
    async () => {
      const capturedAtA = new Date().toISOString();
      const capturedAtB = new Date().toISOString();
      const twoIndependentScenesManifest = {
        ...manifestFixture(),
        compositions: [
          {
            compositionId: "comp-a",
            aeProjectItemIndex: 1,
            name: "Scene A",
            widthPx: 1920,
            heightPx: 1080,
            durationSeconds: 4,
            frameRate: 30,
            isNestedOnlyReferenced: false,
            parentCompositionIds: []
          },
          {
            compositionId: "comp-b",
            aeProjectItemIndex: 2,
            name: "Scene B",
            widthPx: 1920,
            heightPx: 1080,
            durationSeconds: 4,
            frameRate: 30,
            isNestedOnlyReferenced: false,
            parentCompositionIds: []
          }
        ]
      };
      stubWorkspace({
        manifest: twoIndependentScenesManifest,
        scenes: [
          sceneFixture({ id: "scene-a", manifestCompositionId: "comp-a", compositionName: "Scene A", mappings: [] }),
          sceneFixture({ id: "scene-b", manifestCompositionId: "comp-b", compositionName: "Scene B", mappings: [] })
        ],
        extra: {
          "/api/dashboard/status": {
            status: 200,
            body: {
              api: "ok",
              database: "ok",
              workers: [
                {
                  workerId: "11111111-1111-1111-1111-111111111111",
                  name: "Client PC",
                  status: "ONLINE",
                  aeStatus: "ONLINE",
                  mcpStatus: "ONLINE",
                  aeAvailability: "ONLINE",
                  mcpAvailability: "ONLINE",
                  capabilities: ["INSPECT_SCENE_EVIDENCE"],
                  currentJobId: null,
                  maxConcurrency: 1,
                  lastHeartbeatAt: new Date().toISOString()
                }
              ]
            }
          },
          [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-a/preview-status`]: [
            { status: 200, body: { preview: null } },
            {
              status: 200,
              body: {
                preview: {
                  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                  projectId: PROJECT_ID,
                  manifestCompositionId: "comp-a",
                  sourceProjectSha256: "a".repeat(64),
                  filename: "scene-preview-Scene_A.png",
                  mimeType: "image/png",
                  byteSize: 42,
                  capturedAt: capturedAtA,
                  createdAt: capturedAtA
                }
              }
            }
          ],
          [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-b/preview-status`]: [
            { status: 200, body: { preview: null } },
            {
              status: 200,
              body: {
                preview: {
                  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                  projectId: PROJECT_ID,
                  manifestCompositionId: "comp-b",
                  sourceProjectSha256: "a".repeat(64),
                  filename: "scene-preview-Scene_B.png",
                  mimeType: "image/png",
                  byteSize: 42,
                  capturedAt: capturedAtB,
                  createdAt: capturedAtB
                }
              }
            }
          ],
          "/api/jobs": {
            status: 201,
            body: {
              jobId: "33333333-3333-3333-3333-333333333333",
              workerId: "11111111-1111-1111-1111-111111111111",
              operation: "INSPECT_SCENE_EVIDENCE",
              status: "QUEUED",
              createdAt: new Date().toISOString()
            }
          }
        }
      });
      renderView();
      await screen.findByRole("heading", { name: "Scene A" });
      await screen.findByRole("heading", { name: "Scene B" });

      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      const dispatchCallCount = () => fetchMock.mock.calls.filter((call: unknown[]) => call[0] === "/api/jobs").length;

      // Exactly one scene dispatches first - never both at once.
      await waitFor(() => expect(dispatchCallCount()).toBe(1), { timeout: 5000 });
      expect(screen.getAllByText("Preview generating…")).toHaveLength(1);

      // The other scene stays queued (not "Preview generating…") until the first one finishes.
      await waitFor(
        () => {
          expect(dispatchCallCount()).toBe(2);
        },
        { timeout: 10_000 }
      );

      // Both eventually reach a real, AE-sourced preview.
      await waitFor(
        () => {
          expect(screen.getAllByText("After Effects preview")).toHaveLength(2);
        },
        { timeout: 10_000 }
      );
    },
    30_000
  );

  describe("real 2026-09-14 lock: a terminally failed preview never keeps Approve Scenes disabled once every scene decision is complete", () => {
    const JOB_ID = "33333333-3333-3333-3333-333333333333";
    const onlineWorker = {
      workerId: "11111111-1111-1111-1111-111111111111",
      name: "Client PC",
      status: "ONLINE",
      aeStatus: "ONLINE",
      mcpStatus: "ONLINE",
      aeAvailability: "ONLINE",
      mcpAvailability: "ONLINE",
      capabilities: ["INSPECT_SCENE_EVIDENCE"],
      currentJobId: null,
      maxConcurrency: 1,
      lastHeartbeatAt: new Date().toISOString()
    };
    const readyScenes = () => [
      sceneFixture({
        id: "scene-parent",
        manifestCompositionId: "comp-parent",
        compositionName: "App Features",
        mappings: [mappingFixture({ text: "Assets" })],
        approvalState: "READY_FOR_APPROVAL",
        unresolvedReasons: []
      }),
      sceneFixture({
        id: "scene-nested",
        manifestCompositionId: "comp-nested",
        compositionName: "Phone Frame",
        mappings: [],
        approvalState: "READY_FOR_APPROVAL",
        unresolvedReasons: []
      })
    ];
    const jobDto = (status: string) => ({
      // Exact production JobDto shape (jobDtoSchema) - the client parses it strictly.
      job: {
        jobId: JOB_ID,
        workerId: onlineWorker.workerId,
        projectId: PROJECT_ID,
        operation: "INSPECT_SCENE_EVIDENCE",
        status,
        payload: {},
        result: null,
        error: status === "FAILED" ? { code: "NOT_AVAILABLE", message: "could not re-resolve composition" } : null,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        claimedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    it(
      "unlocks as soon as the preview JOB fails - without waiting out the whole polling window on a job that already ended",
      async () => {
        stubWorkspace({
          scenes: readyScenes(),
          extra: {
            "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [onlineWorker] } },
            [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-parent/preview-status`]: { status: 200, body: { preview: null } },
            [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-nested/preview-status`]: { status: 200, body: { preview: null } },
            "/api/jobs": { status: 201, body: { jobId: JOB_ID, workerId: onlineWorker.workerId, operation: "INSPECT_SCENE_EVIDENCE", status: "QUEUED", createdAt: new Date().toISOString() } },
            [`/api/jobs/${JOB_ID}`]: { status: 200, body: jobDto("FAILED") }
          }
        });
        renderView();
        await screen.findByRole("heading", { name: "App Features" });

        await waitFor(() => expect((screen.getByRole("button", { name: "Approve Scenes" }) as HTMLButtonElement).disabled).toBe(false), {
          timeout: 20_000
        });
        expect(screen.queryByText("Updating previews for scenes you just changed - this only takes a moment, no action needed.")).toBeNull();
      },
      30_000
    );

    it("unlocks when the preview dispatch itself is refused", async () => {
      stubWorkspace({
        scenes: readyScenes(),
        extra: {
          "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [onlineWorker] } },
          [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-parent/preview-status`]: { status: 200, body: { preview: null } },
          [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-nested/preview-status`]: { status: 200, body: { preview: null } },
          "/api/jobs": { status: 409, body: { error: { code: "PRECONDITION_NOT_MET", message: "worker is busy", requestId: "req-test" } } }
        }
      });
      renderView();
      await screen.findByRole("heading", { name: "App Features" });

      await waitFor(() => expect((screen.getByRole("button", { name: "Approve Scenes" }) as HTMLButtonElement).disabled).toBe(false), {
        timeout: 10_000
      });
    });

    it(
      "maxConcurrency=1: a WORKER_BUSY refusal waits its turn and retries - no red error, and the scene still reaches a real preview",
      async () => {
        const capturedAt = new Date(Date.now() + 60_000).toISOString();
        stubWorkspace({
          scenes: readyScenes(),
          extra: {
            "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [onlineWorker] } },
            [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-parent/preview-status`]: [
              { status: 200, body: { preview: null } },
              {
                status: 200,
                body: {
                  preview: {
                    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    projectId: PROJECT_ID,
                    manifestCompositionId: "comp-parent",
                    sourceProjectSha256: "a".repeat(64),
                    filename: "scene-preview.png",
                    mimeType: "image/png",
                    byteSize: 42,
                    capturedAt,
                    createdAt: capturedAt
                  }
                }
              }
            ],
            "/api/jobs": [
              { status: 409, body: { error: { code: "WORKER_BUSY", message: "Worker already has a live INSPECT_SCENE_EVIDENCE job in progress", requestId: "req-test" } } },
              { status: 201, body: { jobId: JOB_ID, workerId: onlineWorker.workerId, operation: "INSPECT_SCENE_EVIDENCE", status: "QUEUED", createdAt: new Date().toISOString() } }
            ],
            [`/api/jobs/${JOB_ID}`]: { status: 200, body: jobDto("RUNNING") }
          }
        });
        renderView();
        await screen.findByRole("heading", { name: "App Features" });

        await screen.findByText("After Effects preview", {}, { timeout: 20_000 });
        expect(screen.queryByText(/already has a live/)).toBeNull();
        const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
        expect(fetchMock.mock.calls.filter((call: unknown[]) => call[0] === "/api/jobs").length).toBe(2);
        expect((screen.getByRole("button", { name: "Approve Scenes" }) as HTMLButtonElement).disabled).toBe(false);
      },
      30_000
    );

    it(
      "still keeps Approve Scenes disabled while scene decisions are NOT complete, whatever the previews did",
      async () => {
        stubWorkspace({
          scenes: readyScenes().map((scene) => ({ ...scene, approvalState: "UNREVIEWED", unresolvedReasons: ["1 placeholder(s) in this scene still need a mapping decision"] })),
          extra: {
            "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [onlineWorker] } },
            [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-parent/preview-status`]: { status: 200, body: { preview: null } },
            [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-nested/preview-status`]: { status: 200, body: { preview: null } },
            "/api/jobs": { status: 409, body: { error: { code: "PRECONDITION_NOT_MET", message: "worker is busy", requestId: "req-test" } } }
          }
        });
        renderView();
        await screen.findByRole("heading", { name: "App Features" });

        const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
        // The refused dispatch has happened, so every preview has settled as failed...
        await waitFor(() => expect(fetchMock.mock.calls.some((call: unknown[]) => call[0] === "/api/jobs")).toBe(true), { timeout: 10_000 });
        // ...and approval is STILL held, because a scene decision is missing.
        await waitFor(() => expect(screen.queryByRole("button", { name: "Approve Scenes" })).not.toBeNull());
        expect((screen.getByRole("button", { name: "Approve Scenes" }) as HTMLButtonElement).disabled).toBe(true);
      },
      20_000
    );
  });

  describe("real 2026-09-14 defect: Approve Scenes approved only the plan, leaving no executable scene for Preview", () => {
    const freshPreview = (compositionId: string) => {
      const capturedAt = new Date(Date.now() + 60_000).toISOString();
      return {
        status: 200,
        body: {
          preview: {
            id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            projectId: PROJECT_ID,
            manifestCompositionId: compositionId,
            sourceProjectSha256: "a".repeat(64),
            filename: "scene-preview.png",
            mimeType: "image/png",
            byteSize: 42,
            capturedAt,
            createdAt: capturedAt
          }
        }
      };
    };
    const readyScenes = (approvalState = "READY_FOR_APPROVAL") => [
      sceneFixture({ id: "scene-parent", manifestCompositionId: "comp-parent", compositionName: "App Features", mappings: [mappingFixture({ text: "Assets" })], approvalState, unresolvedReasons: [] }),
      sceneFixture({ id: "scene-nested", manifestCompositionId: "comp-nested", compositionName: "Phone Frame", use: false, mappings: [], approvalState: "READY_FOR_APPROVAL", unresolvedReasons: [] })
    ];
    const planBody = (status: string, revision: number, parentState: string) => ({ plan: planFixture({ status, revision }, readyScenes(parentState)), sceneTable: [] });

    function stubApprovalFlow(initialStatus: string) {
      stubWorkspace({
        scenes: readyScenes(),
        extra: {
          [`/api/projects/${PROJECT_ID}/execution-plan`]: [
            { status: 200, body: planBody(initialStatus, 3, "READY_FOR_APPROVAL") },
            // PATCH (APPROVE_SCENE) - a new DRAFT revision, the normal edit path.
            { status: 200, body: planBody("DRAFT", 4, "APPROVED") }
          ],
          [`/api/projects/${PROJECT_ID}/execution-plan/approve`]: { status: 200, body: planBody("APPROVED", 4, "APPROVED") },
          [`/api/projects/${PROJECT_ID}/execution-plan/scenes/scene-parent/preview-status`]: freshPreview("comp-parent")
        }
      });
    }

    const fetchCalls = () => (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];
    const writes = () => fetchCalls().filter(([, init]) => init?.method === "PATCH" || init?.method === "POST").map(([url, init]) => ({ url, method: init!.method, body: init!.body ? JSON.parse(String(init!.body)) : null }));

    async function waitForApproveEnabled() {
      await screen.findByRole("heading", { name: "App Features" });
      await waitFor(() => expect((screen.getByRole("button", { name: "Approve Scenes" }) as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });
    }

    it(
      "approves every included ready scene through APPROVE_SCENE first, then the plan at that new revision - and then stays disabled with a clear confirmation",
      async () => {
        stubApprovalFlow("DRAFT");
        renderView();
        await waitForApproveEnabled();

        fireEvent.click(screen.getByRole("button", { name: "Approve Scenes" }));

        await screen.findByText("Scenes approved - continue to First Preview.", {}, { timeout: 10_000 });
        const sent = writes();
        expect(sent.map((w) => `${w.method} ${w.url}`)).toEqual([
          `PATCH /api/projects/${PROJECT_ID}/execution-plan`,
          `POST /api/projects/${PROJECT_ID}/execution-plan/approve`
        ]);
        // Only the included scene is approved - never an excluded one.
        expect(sent[0]!.body).toEqual({ baseRevision: 3, operations: [{ type: "APPROVE_SCENE", scenePlanId: "scene-parent" }] });
        expect(sent[1]!.body).toEqual({ baseRevision: 4 });
        expect((screen.getByRole("button", { name: "Approve Scenes" }) as HTMLButtonElement).disabled).toBe(true);
      },
      20_000
    );

    it(
      "recovers a plan the old flow approved while its scene stayed unapproved: approves the scene, then re-approves the plan",
      async () => {
        stubApprovalFlow("APPROVED");
        renderView();
        await waitForApproveEnabled();

        fireEvent.click(screen.getByRole("button", { name: "Approve Scenes" }));

        await screen.findByText("Scenes approved - continue to First Preview.", {}, { timeout: 10_000 });
        expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual([
          `PATCH /api/projects/${PROJECT_ID}/execution-plan`,
          `POST /api/projects/${PROJECT_ID}/execution-plan/approve`
        ]);
      },
      20_000
    );

    it(
      "a rapid double click sends the approval once - never a second request that fails with a technical error",
      async () => {
        stubApprovalFlow("DRAFT");
        renderView();
        await waitForApproveEnabled();

        const button = screen.getByRole("button", { name: "Approve Scenes" });
        fireEvent.click(button);
        fireEvent.click(button);

        await screen.findByText("Scenes approved - continue to First Preview.", {}, { timeout: 10_000 });
        expect(writes()).toHaveLength(2);
        expect(screen.queryByText(/not DRAFT/)).toBeNull();
      },
      20_000
    );
  });

  it("a failed automatic preview (no Worker online) exposes a simple Regenerate Preview retry - never a Jobs/Queue page or internal job wording", async () => {
    stubWorkspace({
      extra: {
        "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } }
      }
    });
    renderView();
    await screen.findByRole("heading", { name: "App Features" });

    await screen.findByText(/No computer is online to generate this preview right now\./, {}, { timeout: 5000 });
    const regenerateButton = screen.getByRole("button", { name: "Regenerate Preview" }) as HTMLButtonElement;
    expect(regenerateButton.disabled).toBe(false);

    expect(screen.queryByText(/\bJobs\b/)).toBeNull();
    expect(screen.queryByText(/\bQueue\b/)).toBeNull();
    expect(screen.queryByText(/INSPECT_SCENE_EVIDENCE/)).toBeNull();
  });
});
