import type { WorkMap } from "@dyo/schemas";
import type { WorkMapRepository } from "../../domain/work-map/types.js";
import { toWorkMapDto } from "./work-map-dto-mapper.js";

export interface GetWorkMapDeps {
  workMapRepository: WorkMapRepository;
}

/** Null (never a 404) is a real, valid state - no work map has been saved for this project yet. */
export async function getWorkMap(deps: GetWorkMapDeps, projectId: string): Promise<WorkMap | null> {
  const record = await deps.workMapRepository.findCurrentByProjectId(projectId);
  return record ? toWorkMapDto(record) : null;
}
