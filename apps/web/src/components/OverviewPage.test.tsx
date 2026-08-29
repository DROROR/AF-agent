// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { OverviewPage } from "./OverviewPage";
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

describe("OverviewPage", () => {
  it("renders real metrics derived from the live worker list once data loads", async () => {
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
            aeAvailability: "ONLINE",
            mcpAvailability: "ONLINE",
            aeVersion: "2026",
            capabilities: ["CHECK_HEALTH"],
            maxConcurrency: 1,
            currentJobId: "job-123",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        fetchedAt: new Date().toISOString()
      }
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <OverviewPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Overview");
    // Workers online: 1 / 1, AE online: 1, MCP online: 1, active jobs: 1.
    expect(await screen.findAllByText("1")).not.toHaveLength(0);
    screen.getByText("1 / 1");
    screen.getByText("Job queue history is not available yet");
  });

  it("shows an error state when the status request itself fails", async () => {
    stubFetch({ ok: false, status: 500, body: {} });

    renderWithLocale(
      <DashboardStatusProvider>
        <OverviewPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("Overview unavailable");
  });

  it("shows zeroed metrics (never fabricated) when there are no workers at all", async () => {
    stubFetch({
      ok: true,
      body: { api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() }
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <OverviewPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("0 / 0");
  });
});
