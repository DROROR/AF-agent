import type { WorkMapEntry } from "@dyo/schemas";

export interface WorkMapRecord {
  id: string;
  projectId: string;
  revision: number;
  entries: WorkMapEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewWorkMapRevision {
  id: string;
  projectId: string;
  revision: number;
  entries: WorkMapEntry[];
}

/** Append-only, same pattern as ExecutionPlanRepository: createRevision never overwrites a prior row. */
export interface WorkMapRepository {
  createRevision(row: NewWorkMapRevision, now: Date): Promise<WorkMapRecord>;
  findCurrentByProjectId(projectId: string): Promise<WorkMapRecord | null>;
}
