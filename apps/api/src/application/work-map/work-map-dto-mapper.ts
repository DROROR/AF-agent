import type { WorkMap } from "@dyo/schemas";
import type { WorkMapRecord } from "../../domain/work-map/types.js";

export function toWorkMapDto(record: WorkMapRecord): WorkMap {
  return {
    id: record.id,
    projectId: record.projectId,
    revision: record.revision,
    entries: record.entries,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
