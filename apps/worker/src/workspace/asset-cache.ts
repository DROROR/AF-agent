import { existsSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { hashSourceProject } from "../inspection/hash-source-project.js";
import { ensureWorkRoot, jobWorkspacePath, safeJoin } from "./work-root.js";

/** Mirrors apps/api/src/domain/asset/mime-allowlist.ts's own extension table - a deliberate small duplication (same rationale as unwrap-jsx-result.ts's own doc comment) rather than a cross-app import between worker and api. Only used to pick a readable local filename; never a security boundary by itself (the sha256 check below is). */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "application/pdf": "pdf"
};

function extensionForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? "bin";
}

/** The one real network call this module needs - implemented via ApiClient.downloadAsset. Kept as a narrow interface so resolveAssetPath itself never imports/constructs an HTTP client directly, matching AerenderRunner/RenderArtifactUploader's own DI seam. Constructed once at worker startup (like RenderArtifactUploader); jobId is passed per-call, never bound at construction. */
export interface AssetDownloadClient {
  download(jobId: string, assetId: string): Promise<Buffer>;
}

export interface ResolveAssetPathParams {
  workRoot: string;
  jobId: string;
  assetId: string;
  /** The asset's real, server-computed sha256 (AssetRecord.sha256, from the dispatch-time MAP_FOOTAGE intent) - never trusted from the downloaded bytes alone. */
  expectedSha256: string;
  mimeType: string;
}

export type ResolveAssetPathResult = { ok: true; assetPath: string } | { ok: false; reason: string };

/**
 * MAP_FOOTAGE's asset-delivery pipeline (activation-phase Gap 2): the
 * destination path is derived ENTIRELY from (workRoot, jobId, assetId) -
 * never a server-supplied filename or path, the same "caller-supplied
 * path is never used directly in an fs call" discipline
 * workspace/working-copy.ts already established for the working copy
 * itself. `jobWorkspacePath`/`safeJoin` give the same traversal-safety
 * guarantee here.
 *
 * Idempotent and resume-safe: if a file already exists at the derived
 * path AND its real sha256 matches `expectedSha256`, it is reused as-is
 * (no re-download) - the same "resume reuses an existing valid copy"
 * shape working-copy.ts uses for the .aep itself. A stale/corrupt/
 * mismatched existing file is deleted before a fresh download is
 * attempted, never silently reused. A freshly downloaded file whose real
 * sha256 does NOT match `expectedSha256` is deleted immediately and
 * reported as a failure - corrupt/wrong bytes are never handed to AE.
 */
export async function resolveAssetPath(client: AssetDownloadClient, params: ResolveAssetPathParams): Promise<ResolveAssetPathResult> {
  const assetsDir = safeJoin(jobWorkspacePath(params.workRoot, params.jobId), "assets");
  const destPath = safeJoin(assetsDir, `${params.assetId}.${extensionForMime(params.mimeType)}`);

  if (existsSync(destPath)) {
    const existingHash = await hashSourceProject(destPath);
    if (existingHash.ok && existingHash.value.sha256 === params.expectedSha256) {
      return { ok: true, assetPath: destPath };
    }
    try {
      unlinkSync(destPath);
    } catch {
      // Best-effort - the write below will surface any real problem.
    }
  }

  let buffer: Buffer;
  try {
    buffer = await client.download(params.jobId, params.assetId);
  } catch (error) {
    return { ok: false, reason: `asset download failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  ensureWorkRoot(assetsDir);
  try {
    await writeFile(destPath, buffer);
  } catch (error) {
    return { ok: false, reason: `could not write downloaded asset to disk: ${error instanceof Error ? error.message : String(error)}` };
  }

  const writtenHash = await hashSourceProject(destPath);
  if (!writtenHash.ok || writtenHash.value.sha256 !== params.expectedSha256) {
    try {
      unlinkSync(destPath);
    } catch {
      // Best-effort cleanup - the failure below is reported regardless.
    }
    return {
      ok: false,
      reason: writtenHash.ok
        ? `downloaded asset sha256 (${writtenHash.value.sha256}) does not match the expected sha256 (${params.expectedSha256}) - deleted the corrupt/wrong file`
        : `could not verify the downloaded asset on disk: ${writtenHash.reason}`
    };
  }

  return { ok: true, assetPath: destPath };
}
