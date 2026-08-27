import { vi } from "vitest";

export const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
export const SOURCE_SHA = "a".repeat(64);

export function manifestFixture() {
  return {
    schemaVersion: "1.0",
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: {
      path: "C:\\vidio agent\\White App Promo (converted).aep",
      name: "White App Promo (converted).aep",
      sha256: SOURCE_SHA
    },
    afterEffects: { version: "26.3x87" },
    generatedAt: new Date().toISOString(),
    compositions: [],
    scenes: [
      { sceneId: "s1", displayName: null, compositionId: "c1", originalOrderIndex: 0, startTimeSeconds: 0, durationSeconds: 4, placeholders: [] }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

export function projectDtoFixture() {
  return {
    projectId: PROJECT_ID,
    name: "White App Promo",
    templateId: "tmpl-1",
    sourceProjectSha256: SOURCE_SHA,
    brandInputs: { logoAssetId: null, brandColors: [], textInstructions: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function sceneFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    use: true,
    sourcePosition: 0,
    finalOrder: null,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    instructions: null,
    notes: null,
    unresolvedReasons: ["no confident structural classification"],
    evidence: [],
    mappings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

export function planFixture(overrides: Record<string, unknown> = {}, scenePlans = [sceneFixture()]) {
  return {
    schemaVersion: "1.0",
    id: "plan-1",
    projectId: PROJECT_ID,
    revision: 3,
    status: "DRAFT",
    templateId: "tmpl-1",
    sourceProjectSha256: SOURCE_SHA,
    approvedAt: null,
    approvedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scenePlans,
    renderOutputs: { LANDSCAPE: null, REELS: null },
    ...overrides
  };
}

export function sceneTableRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    scenePlanId: "scene-1",
    mappingId: null,
    use: true,
    sourcePosition: 0,
    finalOrder: null,
    compositionName: "Scene 01",
    placeholderLabel: null,
    placeholderClassification: null,
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    notes: null,
    instructions: null,
    unresolvedReasons: ["no confident structural classification"],
    ...overrides
  };
}

export function assetFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    projectId: PROJECT_ID,
    originalFilename: "logo.png",
    storageKey: `${PROJECT_ID}/asset-1.png`,
    mediaKind: "IMAGE",
    mimeType: "image/png",
    byteSize: 2048,
    sha256: "b".repeat(64),
    width: null,
    height: null,
    durationSeconds: null,
    label: null,
    notes: null,
    uploadedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

export function workMapEntryFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "wm-entry-1",
    sourceCompositionId: null,
    sourceReference: "Scene 1",
    desiredAssetId: null,
    desiredText: "Hello world",
    assetTimestampSeconds: null,
    desiredDurationSeconds: null,
    instructions: null,
    ...overrides
  };
}

export function workMapFixture(overrides: Record<string, unknown> = {}, entries = [workMapEntryFixture()]) {
  return {
    id: "wm-1",
    projectId: PROJECT_ID,
    revision: 1,
    entries,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

export function mappingSuggestionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "suggestion-1",
    projectId: PROJECT_ID,
    scenePlanId: "scene-1",
    mappingId: "mapping-1",
    source: "DETERMINISTIC",
    status: "PENDING",
    suggestedClassification: null,
    suggestedAssetId: null,
    suggestedText: null,
    suggestedAssetTimestamp: null,
    suggestedFinalDuration: null,
    confidence: 1,
    reasoning: "The Work Map explicitly assigns this asset to this scene.",
    evidenceRefs: [{ kind: "USER_INTENT", summary: "Work Map entry for this scene names asset \"Client logo\"" }],
    unresolvedReason: null,
    requiresHumanReview: false,
    conflictsWithWorkMap: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

export function renderArtifactFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    projectId: PROJECT_ID,
    jobId: "22222222-2222-2222-2222-222222222222",
    variant: "LANDSCAPE",
    compositionName: "Landscape Master",
    workingProjectSha256: SOURCE_SHA,
    filename: "output.mp4",
    mimeType: "video/mp4",
    byteSize: 2048,
    sha256: "c".repeat(64),
    renderStartedAt: new Date().toISOString(),
    renderCompletedAt: new Date().toISOString(),
    aerenderExitCode: 0,
    validationStatus: "VALID",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

interface HandlerSpec {
  status: number;
  body: unknown;
}

/**
 * Routes a stubbed global fetch to the handler whose URL substring pattern
 * is the LONGEST match (never the first-inserted one) - a naive
 * first-match lookup would let a short pattern like "/api/projects"
 * shadow a more specific one like "/api/projects/:id/execution-plan",
 * since every request URL contains the shorter string too.
 */
export function stubFetchByUrl(handlers: Record<string, HandlerSpec | HandlerSpec[]>): void {
  const callCounts = new Map<string, number>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const [pattern, spec] =
        Object.entries(handlers)
          .sort((a, b) => b[0].length - a[0].length)
          .find(([candidate]) => url.includes(candidate)) ?? [];
      if (!spec) {
        return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
      }
      const specs = Array.isArray(spec) ? spec : [spec];
      const callIndex = callCounts.get(pattern!) ?? 0;
      callCounts.set(pattern!, callIndex + 1);
      const resolved = specs[Math.min(callIndex, specs.length - 1)]!;
      return {
        ok: resolved.status >= 200 && resolved.status < 300,
        status: resolved.status,
        // Both provided - projects-api-client.ts's own request() helper only
        // ever calls .text() (then JSON.parses it manually), but other
        // callers (e.g. use-dashboard-status.ts) call .json() directly on a
        // real Response - a faithful stub supports both the same way.
        text: async () => JSON.stringify(resolved.body),
        json: async () => resolved.body
      };
    })
  );
}
