// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION } from "@dyo/schemas";
import { NewProjectWizard } from "./NewProjectWizard";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { LocaleProvider } from "./LocaleProvider";
import { stubFetchByUrl } from "../test-utils/execution-plan-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function worker(overrides: Record<string, unknown> = {}) {
  return {
    workerId: "44444444-4444-4444-4444-444444444444",
    name: "worker-a",
    status: "ONLINE",
    lastHeartbeatAt: new Date().toISOString(),
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeVersion: "26.0",
    capabilities: ["INSPECT_TEMPLATE"],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function manifest() {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "t1",
    templateName: "t1",
    sourceProject: { path: "/copies/t1.aep", name: "t1.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.0" },
    generatedAt: new Date().toISOString(),
    compositions: [],
    scenes: [],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

function inspectionSummary() {
  return {
    compositionCount: 3,
    candidateSceneCount: 2,
    editablePlaceholderCount: 5,
    nestedCompositionCount: 1,
    requiredFontCount: 0,
    footageReferencedCount: 4,
    missingFootageCount: 0,
    pluginReferenceCount: 0,
    unknownItemCount: 1
  };
}

function renderWizard(): void {
  render(
    <LocaleProvider>
      <DashboardStatusProvider>
        <NewProjectWizard />
      </DashboardStatusProvider>
    </LocaleProvider>
  );
}

async function goToTemplateStep(): Promise<void> {
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Real Project" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** Waits for the async dashboard-status fetch to resolve (the worker <select> only renders once eligibleWorkers is non-empty), then selects the given worker and fills in the template fields. */
async function selectWorkerAndFillTemplateFields(workerId = "44444444-4444-4444-4444-444444444444"): Promise<void> {
  await waitFor(() => expect(screen.getByRole("combobox")).not.toBeNull());
  fireEvent.change(screen.getByRole("combobox"), { target: { value: workerId } });
  fireEvent.change(screen.getByLabelText("Template ID"), { target: { value: "tmpl-1" } });
  fireEvent.change(screen.getByLabelText("Source project path (on the Worker machine)"), { target: { value: "/copies/t1.aep" } });
}

describe("NewProjectWizard", () => {
  it("shows an honest empty state when no worker reports INSPECT_TEMPLATE - never a fake/disabled control", async () => {
    stubFetchByUrl({ "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [] } } });
    renderWizard();
    await goToTemplateStep();

    expect(await screen.findByText("No Worker reports the INSPECT_TEMPLATE capability")).not.toBeNull();
  });

  it("disables Inspect Template until a real, fully-online eligible worker plus template fields are filled in", async () => {
    stubFetchByUrl({ "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker()] } } });
    renderWizard();
    await goToTemplateStep();

    await waitFor(() => expect(screen.getByRole("combobox")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Inspect Template" }).hasAttribute("disabled")).toBe(true);

    await selectWorkerAndFillTemplateFields();

    expect(screen.getByRole("button", { name: "Inspect Template" }).hasAttribute("disabled")).toBe(false);
  });

  it("does not enable inspection for a worker missing AE/MCP preconditions, even though it reports the capability", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker({ aeStatus: "OFFLINE" })] } }
    });
    renderWizard();
    await goToTemplateStep();
    await selectWorkerAndFillTemplateFields();

    expect(screen.getByRole("button", { name: "Inspect Template" }).hasAttribute("disabled")).toBe(true);
  });

  it("dispatches a real job, shows running progress, then the real completed result with source SHA - and lets the operator promote it into a real project", async () => {
    // Two real poll ticks (POLL_INTERVAL_MS=2000 in the component) happen
    // sequentially in this one test - real timers, not faked - so the
    // default per-test timeout is not enough.
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker()] } },
      "/api/jobs/11111111-1111-1111-1111-111111111111": [
        {
          status: 200,
          body: {
            job: {
              jobId: "11111111-1111-1111-1111-111111111111",
              workerId: "44444444-4444-4444-4444-444444444444",
              projectId: null,
              operation: "INSPECT_TEMPLATE",
              status: "RUNNING",
              payload: {},
              result: null,
              error: null,
              checkpoint: null,
              createdAt: new Date().toISOString(),
              claimedAt: new Date().toISOString(),
              startedAt: new Date().toISOString(),
              completedAt: null,
              updatedAt: new Date().toISOString()
            }
          }
        },
        {
          status: 200,
          body: {
            job: {
              jobId: "11111111-1111-1111-1111-111111111111",
              workerId: "44444444-4444-4444-4444-444444444444",
              projectId: null,
              operation: "INSPECT_TEMPLATE",
              status: "SUCCEEDED",
              payload: {},
              result: { manifest: manifest(), summary: inspectionSummary() },
              error: null,
              checkpoint: null,
              createdAt: new Date().toISOString(),
              claimedAt: new Date().toISOString(),
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          }
        }
      ],
      "/api/jobs": {
        status: 201,
        body: {
          jobId: "11111111-1111-1111-1111-111111111111",
          workerId: "44444444-4444-4444-4444-444444444444",
          operation: "INSPECT_TEMPLATE",
          status: "QUEUED",
          createdAt: new Date().toISOString()
        }
      },
      "/api/projects": {
        status: 201,
        body: {
          projectId: "22222222-2222-2222-2222-222222222222",
          name: "Real Project",
          templateId: "t1",
          sourceProjectSha256: "a".repeat(64),
          brandInputs: { logoAssetId: null, brandColors: [], textInstructions: null },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    });

    renderWizard();
    await goToTemplateStep();
    await selectWorkerAndFillTemplateFields();
    fireEvent.click(screen.getByRole("button", { name: "Inspect Template" }));

    await waitFor(() => expect(screen.getByText("Inspecting the real template on the Worker now...")).not.toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText("Inspection result")).not.toBeNull(), { timeout: 5000 });

    expect(screen.getByText("Compositions").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByText("Candidate scenes").nextElementSibling?.textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

    // Real promotion happened - a real POST /api/projects call was made
    // carrying the operator-entered name and the job's own real manifest
    // (never a curl/manual step, never a fabricated success).
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
      const promoteCall = calls.find(([url]) => url === "/api/projects");
      expect(promoteCall).toBeDefined();
      const sentBody = JSON.parse(promoteCall![1].body as string) as { name: string; manifest: { sourceProject: { sha256: string } } };
      expect(sentBody.name).toBe("Real Project");
      expect(sentBody.manifest.sourceProject.sha256).toBe("a".repeat(64));
    });
  }, 15000);

  it("shows the real failure reason and offers to retry - never a generic dead end", async () => {
    stubFetchByUrl({
      "/api/dashboard/status": { status: 200, body: { api: "ok", database: "ok", workers: [worker()] } },
      "/api/jobs/11111111-1111-1111-1111-111111111111": {
        status: 200,
        body: {
          job: {
            jobId: "11111111-1111-1111-1111-111111111111",
            workerId: "44444444-4444-4444-4444-444444444444",
            projectId: null,
            operation: "INSPECT_TEMPLATE",
            status: "FAILED",
            payload: {},
            result: null,
            error: { code: "TRANSPORT_ERROR", message: "bridge unreachable" },
            checkpoint: null,
            createdAt: new Date().toISOString(),
            claimedAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }
      },
      "/api/jobs": {
        status: 201,
        body: {
          jobId: "11111111-1111-1111-1111-111111111111",
          workerId: "44444444-4444-4444-4444-444444444444",
          operation: "INSPECT_TEMPLATE",
          status: "QUEUED",
          createdAt: new Date().toISOString()
        }
      }
    });

    renderWizard();
    await goToTemplateStep();
    await selectWorkerAndFillTemplateFields();
    fireEvent.click(screen.getByRole("button", { name: "Inspect Template" }));

    await waitFor(() => expect(screen.getByText("bridge unreachable")).not.toBeNull(), { timeout: 5000 });
    expect(screen.getByRole("button", { name: "Inspect again" }).hasAttribute("disabled")).toBe(false);
  });
});
