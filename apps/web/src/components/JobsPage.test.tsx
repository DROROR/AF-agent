// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { JobsPage } from "./JobsPage";
import { renderWithLocale } from "../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(response: { ok: boolean; status?: number; body: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body
    })
  );
}

describe("JobsPage", () => {
  it("lists real jobs currently claimed by a worker, derived from the live worker list", async () => {
    stubFetch({
      ok: true,
      body: {
        api: "ok",
        database: "ok",
        workers: [
          {
            workerId: "11111111-1111-1111-1111-111111111111",
            name: "worker-a",
            status: "ONLINE",
            lastHeartbeatAt: new Date().toISOString(),
            aeStatus: "ONLINE",
            mcpStatus: "ONLINE",
            aeVersion: "2026",
            capabilities: ["EXECUTE_FRAME"],
            maxConcurrency: 1,
            currentJobId: "22222222-2222-2222-2222-222222222222",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        fetchedAt: new Date().toISOString()
      }
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Jobs / Queue");
    screen.getByText("worker-a");
    screen.getByText("22222222-2222-2222-2222-222222222222");
  });

  it("shows the honest empty state - never a fabricated job - when no worker currently has one claimed", async () => {
    stubFetch({
      ok: true,
      body: { api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() }
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("No jobs currently claimed");
  });

  it("shows an error state when the status request itself fails", async () => {
    stubFetch({ ok: false, status: 500, body: {} });

    renderWithLocale(
      <DashboardStatusProvider>
        <JobsPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Jobs unavailable");
  });
});
