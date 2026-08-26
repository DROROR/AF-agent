"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssetDto, MediaKind } from "@dyo/schemas";
import { deleteAsset, fetchAssets, updateAsset, uploadAsset, type ApiResult } from "./projects-api-client";

export interface ProjectAssetsState {
  assets: AssetDto[] | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  upload: (file: File, mediaKind?: MediaKind) => Promise<ApiResult<AssetDto>>;
  update: (assetId: string, body: { label?: string | null; notes?: string | null }) => Promise<ApiResult<AssetDto>>;
  remove: (assetId: string) => Promise<ApiResult<true>>;
}

/**
 * Real Asset Catalog state for one project - fetched only by the Assets
 * tab (and the Scene Mapping asset picker), not part of the shared
 * ProjectWorkspaceProvider load, since most workspace visits never touch
 * either. Mirrors use-execution-plan-revisions.ts's on-demand fetch shape.
 */
export function useProjectAssets(projectId: string): ProjectAssetsState {
  const [assets, setAssets] = useState<AssetDto[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchAssets(projectId);
    if (result.ok) {
      setAssets(result.data);
      setError(null);
    } else {
      setError(result.message);
    }
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    // load() only calls setState after its own first `await` - same
    // accepted pattern as use-project-workspace.ts's own effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const upload = useCallback(
    async (file: File, mediaKind?: MediaKind): Promise<ApiResult<AssetDto>> => {
      const result = await uploadAsset(projectId, file, mediaKind);
      if (result.ok) {
        await load();
      }
      return result;
    },
    [projectId, load]
  );

  const update = useCallback(
    async (assetId: string, body: { label?: string | null; notes?: string | null }): Promise<ApiResult<AssetDto>> => {
      const result = await updateAsset(projectId, assetId, body);
      if (result.ok) {
        await load();
      }
      return result;
    },
    [projectId, load]
  );

  const remove = useCallback(
    async (assetId: string): Promise<ApiResult<true>> => {
      const result = await deleteAsset(projectId, assetId);
      if (result.ok) {
        await load();
      }
      return result;
    },
    [projectId, load]
  );

  return { assets, isLoading, error, refetch: load, upload, update, remove };
}
