import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Live QA Blocker 1, section 6 item E: "No hardcoded QA/client worker IDs
 * in production logic." Worker affinity must always come from real,
 * recorded provenance (project.sourceWorkerId - see
 * packages/database/src/schema.ts) or an explicit runtime request, never a
 * literal id baked into source. This is the durable, automated proof: it
 * scans exactly the production dispatch/selection files this fix touches
 * or could plausibly have hardcoded a shortcut into, for the two real
 * Worker ids named in the live QA report (the QA worker, and the client
 * worker this fix exists to stop cross-dispatching to).
 *
 * Deliberately NOT a whole-repo scan: apps/worker's own reconciliation
 * tests and a historical doc comment legitimately use one of these same
 * ids as a realistic pre-existing test fixture / incident reference,
 * unrelated to worker SELECTION logic and out of Blocker 1's scope - a
 * repo-wide scan would flag those as false positives.
 */
const FORBIDDEN_LITERAL_IDS = ["accd0a71-dbd6-4a53-8b81-d3fe4609420b", "345ee0a4-ef4d-4b87-a923-726f97144aa4"];

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(THIS_DIR, "..", "..", "..", "..", "..", "..");

const SCANNED_FILES = [
  "apps/api/src/application/job/dispatch-job.ts",
  "apps/api/src/application/execution-session/create-execution-session.ts",
  "apps/api/src/application/project/create-project.ts",
  "apps/api/src/infrastructure/db/drizzle-project-repository.ts",
  "apps/web/src/lib/find-dispatchable-worker.ts",
  "apps/web/src/lib/resolve-project-worker.ts",
  "apps/web/src/components/NewProjectWizard.tsx",
  "apps/web/src/components/MappingAssistantPanel.tsx",
  "apps/web/src/components/ProjectPreviewTab.tsx",
  "apps/web/src/components/ProjectRenderSettingsTab.tsx",
  "apps/web/src/lib/use-scene-preview-queue.ts",
  "apps/web/src/components/SimpleScenesView.tsx",
  "packages/schemas/src/worker.ts",
  "packages/database/src/schema.ts"
];

describe("no hardcoded QA/client worker ids in production logic (live QA Blocker 1)", () => {
  it("never contains either real Worker id named in the live QA report, in any production worker-affinity/dispatch/selection file", () => {
    const offenders: string[] = [];
    for (const relativePath of SCANNED_FILES) {
      const content = readFileSync(join(REPO_ROOT, relativePath), "utf8");
      for (const id of FORBIDDEN_LITERAL_IDS) {
        if (content.includes(id)) {
          offenders.push(`${relative(REPO_ROOT, relativePath)} contains forbidden literal id ${id}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
