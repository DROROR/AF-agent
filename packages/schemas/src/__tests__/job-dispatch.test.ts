import { describe, expect, it } from "vitest";
import { DISPATCHABLE_OPERATIONS, dispatchJobRequestSchema } from "../job-dispatch.js";

const WORKER_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";

describe("DISPATCHABLE_OPERATIONS", () => {
  it("includes all seven activated capabilities, in the order routes/dashboard should expect", () => {
    expect(DISPATCHABLE_OPERATIONS).toEqual([
      "INSPECT_TEMPLATE",
      "CHECK_HEALTH",
      "INSPECT_SCENE_EVIDENCE",
      "INSPECT_RENDER_CAPABILITIES",
      "EXECUTE_FRAME",
      "CREATE_PREVIEW",
      "RENDER"
    ]);
  });
});

describe("dispatchJobRequestSchema - EXECUTE_FRAME never accepts a raw worker payload", () => {
  it("accepts the minimal intent shape", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "EXECUTE_FRAME",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        scenePlanId: "scene-1"
      })
    ).not.toThrow();
  });

  it("rejects a missing executionSessionId - worker affinity/chain-of-custody require a real session, never inferred", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({ operation: "EXECUTE_FRAME", workerId: WORKER_ID, projectId: PROJECT_ID, scenePlanId: "scene-1" })
    ).toThrow();
  });

  it("rejects a raw workingProjectPath - the worker derives it internally, never the caller", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "EXECUTE_FRAME",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        scenePlanId: "scene-1",
        workingProjectPath: "C:\\DYO-Agent\\execution-sessions\\session-1\\working-copy.aep"
      })
    ).toThrow();
  });

  it("rejects a raw sourceProjectPath - resolved server-side from the project's own manifest, never the caller", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "EXECUTE_FRAME",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        scenePlanId: "scene-1",
        sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep"
      })
    ).toThrow();
  });

  it("rejects a raw aeProjectItemIndex/compositionName - resolved server-side from the current manifest, never the caller", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "EXECUTE_FRAME",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        scenePlanId: "scene-1",
        aeProjectItemIndex: 5,
        compositionName: "Scene 01"
      })
    ).toThrow();
  });

  it("rejects raw operations (arbitrary JSX/asset paths) - resolved server-side from the scene's own approved mappings, never the caller", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "EXECUTE_FRAME",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        scenePlanId: "scene-1",
        operations: [{ type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, assetPath: "C:\\evil\\payload.jsx" }]
      })
    ).toThrow();
  });

  it("rejects an unrelated payload field entirely (no `payload` field exists on this operation at all)", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "EXECUTE_FRAME",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        scenePlanId: "scene-1",
        payload: { anything: "at all" }
      })
    ).toThrow();
  });
});

describe("dispatchJobRequestSchema - INSPECT_SCENE_EVIDENCE never accepts a raw worker payload", () => {
  it("accepts the minimal intent shape", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        scenePlanId: "scene-1"
      })
    ).not.toThrow();
  });

  it("rejects a missing scenePlanId - the scene to inspect is never inferred", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({ operation: "INSPECT_SCENE_EVIDENCE", workerId: WORKER_ID, projectId: PROJECT_ID })
    ).toThrow();
  });

  it("rejects a raw sourceProjectPath - a real Windows filesystem path is never accepted from the browser, resolved server-side from the project's own manifest instead", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        scenePlanId: "scene-1",
        sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep"
      })
    ).toThrow();
  });

  it("rejects raw layerIndices - resolved server-side from the scene's own manifest placeholders, never the caller", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        scenePlanId: "scene-1",
        layerIndices: [1, 2, 3]
      })
    ).toThrow();
  });

  it("rejects the old raw `payload` field entirely - no payload passthrough exists on this operation anymore", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "INSPECT_SCENE_EVIDENCE",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        scenePlanId: "scene-1",
        payload: {
          sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep",
          sourceProjectSha256: "a".repeat(64),
          manifestCompositionId: "comp-1",
          aeProjectItemIndex: 1,
          compositionName: "Scene 01",
          layerIndices: [1],
          previewTimestampSeconds: null
        }
      })
    ).toThrow();
  });
});

describe("dispatchJobRequestSchema - RENDER never accepts a raw worker payload", () => {
  it("accepts the minimal intent shape (variant only)", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "RENDER",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        variant: "LANDSCAPE"
      })
    ).not.toThrow();
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "RENDER",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        variant: "REELS"
      })
    ).not.toThrow();
  });

  it("rejects a missing executionSessionId - RENDER now derives its working copy from the session, never a raw path", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({ operation: "RENDER", workerId: WORKER_ID, projectId: PROJECT_ID, variant: "LANDSCAPE" })
    ).toThrow();
  });

  it("rejects an invalid variant - never an arbitrary output name", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "RENDER",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        variant: "SQUARE"
      })
    ).toThrow();
  });

  it("rejects a raw workingProjectPath/sourceProjectPath - resolved server-side from persisted state, never the caller", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "RENDER",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        variant: "LANDSCAPE",
        workingProjectPath: "C:\\DYO-Agent\\execution-sessions\\session-1\\working-copy.aep",
        sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep"
      })
    ).toThrow();
  });

  it("rejects raw renderSettingsTemplateName/outputModuleTemplateName/aeProjectItemIndex - resolved server-side from the persisted RenderOutputConfig, never the caller", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "RENDER",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        variant: "LANDSCAPE",
        renderSettingsTemplateName: "Best Settings",
        outputModuleTemplateName: "H.264 - Match Source",
        aeProjectItemIndex: 5
      })
    ).toThrow();
  });

  it("rejects an unrelated payload field entirely (no `payload` field exists on this operation at all - never a generic aerender-args passthrough)", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "RENDER",
        workerId: WORKER_ID,
        projectId: PROJECT_ID,
        executionSessionId: SESSION_ID,
        variant: "LANDSCAPE",
        payload: { aerenderArgs: ["-RStemplate", "evil"] }
      })
    ).toThrow();
  });
});

describe("dispatchJobRequestSchema - INSPECT_RENDER_CAPABILITIES stays read-only", () => {
  it("accepts the minimal shape with a strictly empty payload", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({ operation: "INSPECT_RENDER_CAPABILITIES", workerId: WORKER_ID, payload: {} })
    ).not.toThrow();
  });

  it("rejects any field inside payload - never an arbitrary command/mutation smuggled in", () => {
    expect(() =>
      dispatchJobRequestSchema.parse({
        operation: "INSPECT_RENDER_CAPABILITIES",
        workerId: WORKER_ID,
        payload: { save: true }
      })
    ).toThrow();
  });
});

describe("dispatchJobRequestSchema rejects an arbitrary/unsupported operation", () => {
  it("rejects an operation string outside the fixed allowlist", () => {
    expect(() => dispatchJobRequestSchema.parse({ operation: "DELETE_EVERYTHING", workerId: WORKER_ID, payload: {} })).toThrow();
  });
});
