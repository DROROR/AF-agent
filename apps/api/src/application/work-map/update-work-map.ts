import { randomUUID } from "node:crypto";
import type { UpdateWorkMapRequest, WorkMap } from "@dyo/schemas";
import { StaleWorkMapRevisionError } from "../../errors/app-error.js";
import type { WorkMapRepository } from "../../domain/work-map/types.js";
import { toWorkMapDto } from "./work-map-dto-mapper.js";

export interface UpdateWorkMapDeps {
  workMapRepository: WorkMapRepository;
  now: () => Date;
}

/**
 * Replaces the whole entry list as one new revision - baseRevision 0
 * means "no work map exists yet, create the first one" (mirrors
 * create-execution-plan.ts's own revision-1 convention, but folded into
 * one PUT here since a work map has no separate "create" action).
 * Deliberately does NOT validate `desiredAssetId` against the real Asset
 * Catalog - a work-map entry is user INTENT, not yet an approved
 * execution instruction (see work-map.ts's own doc comment); the real
 * cross-project/existence check happens at the point intent actually
 * becomes an instruction - MAP_ASSET on the execution plan.
 */
export async function updateWorkMap(deps: UpdateWorkMapDeps, projectId: string, request: UpdateWorkMapRequest): Promise<WorkMap> {
  const current = await deps.workMapRepository.findCurrentByProjectId(projectId);
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== request.baseRevision) {
    throw new StaleWorkMapRevisionError(request.baseRevision, currentRevision);
  }

  const now = deps.now();
  const entries = request.entries.map((entry) => ({ ...entry, id: entry.id ?? randomUUID() }));
  const created = await deps.workMapRepository.createRevision(
    { id: randomUUID(), projectId, revision: currentRevision + 1, entries },
    now
  );
  return toWorkMapDto(created);
}
