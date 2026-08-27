import type { SceneEditOperation, SceneEditOperationIntent } from "@dyo/schemas";
import { resolveAssetPath, type AssetDownloadClient } from "../workspace/asset-cache.js";

export type ResolveSceneEditOperationResult = { ok: true; operation: SceneEditOperation } | { ok: false; reason: string };

export interface ResolveSceneEditOperationDeps {
  workRoot: string;
  jobId: string;
  assetDownloadClient: AssetDownloadClient;
}

/**
 * Translates ONE dispatch-facing SceneEditOperationIntent into the real,
 * resolved SceneEditOperation ae-edit-bridge.ts/jsx-templates.ts expect -
 * the one place asset intents ever become a real worker-local file path
 * (see workspace/asset-cache.ts). Every non-MAP_FOOTAGE intent is already
 * structurally identical to its resolved form and passes through
 * unchanged; only MAP_FOOTAGE requires a real network call (and is
 * therefore resolved lazily, per-operation, immediately before it is
 * applied - never all operations up front) - see
 * execute-scene-edit-executor.ts's own call site.
 */
export async function resolveSceneEditOperation(
  deps: ResolveSceneEditOperationDeps,
  intent: SceneEditOperationIntent
): Promise<ResolveSceneEditOperationResult> {
  if (intent.type !== "MAP_FOOTAGE") {
    return { ok: true, operation: intent };
  }

  const resolved = await resolveAssetPath(deps.assetDownloadClient, {
    workRoot: deps.workRoot,
    jobId: deps.jobId,
    assetId: intent.assetId,
    expectedSha256: intent.expectedSha256,
    mimeType: intent.mimeType
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  return {
    ok: true,
    operation: {
      type: "MAP_FOOTAGE",
      manifestPlaceholderId: intent.manifestPlaceholderId,
      layerIndex: intent.layerIndex,
      assetPath: resolved.assetPath
    }
  };
}

/** Real, network-backed AssetDownloadClient - constructed once at worker startup from the same ApiClient/worker-identity pair RenderArtifactUploader already uses; jobId is passed per-call, matching that same class's own convention. */
export class HeroicSwanAssetDownloadClient implements AssetDownloadClient {
  constructor(
    private readonly apiClient: { downloadAsset(workerId: string, workerToken: string, jobId: string, assetId: string): Promise<Buffer> },
    private readonly workerId: string,
    private readonly workerToken: string
  ) {}

  async download(jobId: string, assetId: string): Promise<Buffer> {
    return this.apiClient.downloadAsset(this.workerId, this.workerToken, jobId, assetId);
  }
}
