import { eq, isNull } from "drizzle-orm";
import { createDatabase, type Database } from "./client.js";
import { jobs, projects } from "./schema.js";

/**
 * Live QA Blocker 1, section 3 - recovers `projects.source_worker_id` for a
 * project that predates that column, from its own real inspection
 * provenance: a SUCCEEDED INSPECT_TEMPLATE job whose result manifest
 * sha256 exactly matches the project's own `manifest.sourceProject.sha256`.
 * This never invents provenance - it is the exact same sha256 the project
 * itself was created from, so an exact match is the real Worker that
 * inspected it. If more than one distinct Worker's SUCCEEDED job matches
 * (should not happen in practice - sha256 is effectively unique per source
 * .aep - but never assumed), that project is left AMBIGUOUS and skipped
 * rather than guessed.
 *
 * Pure/DB-free by design so the matching logic itself is unit-testable
 * without a live Postgres connection - see backfill-source-worker-id.test.ts.
 */
export interface BackfillCandidateProject {
  projectId: string;
  sourceProjectSha256: string;
}

export interface SucceededInspectTemplateJob {
  workerId: string;
  /** The SUCCEEDED job's own result manifest sha256 - see InspectTemplateResult's `{ kind: "manifest", response: { manifest } }` shape. */
  resultManifestSha256: string;
}

export type BackfillPlanEntry =
  | { projectId: string; outcome: "MATCH"; workerId: string }
  | { projectId: string; outcome: "NO_MATCH" }
  | { projectId: string; outcome: "AMBIGUOUS"; candidateWorkerIds: string[] };

export function computeSourceWorkerIdBackfillPlan(
  candidateProjects: BackfillCandidateProject[],
  succeededInspectTemplateJobs: SucceededInspectTemplateJob[]
): BackfillPlanEntry[] {
  return candidateProjects.map((project) => {
    const distinctMatchingWorkerIds = [
      ...new Set(
        succeededInspectTemplateJobs
          .filter((job) => job.resultManifestSha256 === project.sourceProjectSha256)
          .map((job) => job.workerId)
      )
    ];
    if (distinctMatchingWorkerIds.length === 0) {
      return { projectId: project.projectId, outcome: "NO_MATCH" };
    }
    if (distinctMatchingWorkerIds.length > 1) {
      return { projectId: project.projectId, outcome: "AMBIGUOUS", candidateWorkerIds: distinctMatchingWorkerIds };
    }
    return { projectId: project.projectId, outcome: "MATCH", workerId: distinctMatchingWorkerIds[0]! };
  });
}

async function loadCandidateProjects(db: Database): Promise<BackfillCandidateProject[]> {
  const rows = await db
    .select({ id: projects.id, sourceProjectSha256: projects.sourceProjectSha256 })
    .from(projects)
    .where(isNull(projects.sourceWorkerId));
  return rows.map((row) => ({ projectId: row.id, sourceProjectSha256: row.sourceProjectSha256 }));
}

/**
 * Manifest shape is validated at write time (INSPECT_TEMPLATE's own result
 * schema) - here we only need to read one field back out of already-trusted
 * jsonb, so this stays a narrow, defensive read rather than a full
 * re-validation against templateManifestSchema.
 */
function extractManifestSha256(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const kind = (result as Record<string, unknown>)["kind"];
  if (kind !== "manifest") return null;
  const response = (result as Record<string, unknown>)["response"];
  if (typeof response !== "object" || response === null) return null;
  const manifest = (response as Record<string, unknown>)["manifest"];
  if (typeof manifest !== "object" || manifest === null) return null;
  const sourceProject = (manifest as Record<string, unknown>)["sourceProject"];
  if (typeof sourceProject !== "object" || sourceProject === null) return null;
  const sha256 = (sourceProject as Record<string, unknown>)["sha256"];
  return typeof sha256 === "string" ? sha256 : null;
}

async function loadSucceededInspectTemplateJobs(db: Database): Promise<SucceededInspectTemplateJob[]> {
  const rows = await db
    .select({ workerId: jobs.workerId, result: jobs.result })
    .from(jobs)
    .where(eq(jobs.operation, "INSPECT_TEMPLATE"));
  const out: SucceededInspectTemplateJob[] = [];
  for (const row of rows) {
    const sha256 = extractManifestSha256(row.result);
    if (sha256) {
      out.push({ workerId: row.workerId, resultManifestSha256: sha256 });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const { db, pool } = createDatabase(connectionString);
  try {
    const candidateProjects = await loadCandidateProjects(db);
    const succeededJobs = await loadSucceededInspectTemplateJobs(db);
    const plan = computeSourceWorkerIdBackfillPlan(candidateProjects, succeededJobs);

    for (const entry of plan) {
      if (entry.outcome === "MATCH") {
        console.log(`${entry.projectId}: MATCH -> sourceWorkerId = ${entry.workerId}${apply ? " (applying)" : " (dry run - pass --apply to write)"}`);
        if (apply) {
          await db.update(projects).set({ sourceWorkerId: entry.workerId }).where(eq(projects.id, entry.projectId));
        }
      } else if (entry.outcome === "AMBIGUOUS") {
        console.log(`${entry.projectId}: AMBIGUOUS - multiple distinct Workers match (${entry.candidateWorkerIds.join(", ")}) - skipped, needs manual review`);
      } else {
        console.log(`${entry.projectId}: NO_MATCH - no SUCCEEDED INSPECT_TEMPLATE job's result manifest sha256 matches this project - skipped`);
      }
    }
    if (plan.length === 0) {
      console.log("No projects with a null sourceWorkerId - nothing to do.");
    }
  } finally {
    await pool.end();
  }
}

// Only runs when invoked directly (tsx src/backfill-source-worker-id.ts) -
// never as a side effect of this test file importing the pure function above.
if (process.argv[1] && process.argv[1].endsWith("backfill-source-worker-id.ts")) {
  void main();
}
