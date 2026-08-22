import type { WorkerDto } from "@dyo/schemas";

/** No runtime imports on purpose - safe to import from both server and client code without pulling either side's implementation into the other's bundle. */
export type ComponentHealth = "ok" | "error" | "unknown";

export interface DashboardStatus {
  api: "ok" | "error";
  database: ComponentHealth;
  /** null means the worker list itself could not be fetched/parsed - distinct from an empty array (no workers registered). */
  workers: WorkerDto[] | null;
  fetchedAt: string;
}
