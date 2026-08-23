// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

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

describe("Dashboard", () => {
  it("renders system health and a worker row once data loads", async () => {
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
            mcpStatus: "UNKNOWN",
            aeVersion: "2026",
            capabilities: ["CHECK_HEALTH"],
            maxConcurrency: 1,
            currentJobId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        fetchedAt: new Date().toISOString()
      }
    });

    render(<Dashboard />);

    // findByText/getAllByText already throw if nothing matches.
    await screen.findByText("worker-a");
    expect(screen.getAllByText("Online").length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no workers", async () => {
    stubFetch({
      ok: true,
      body: { api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() }
    });

    render(<Dashboard />);

    await screen.findByText("No workers registered");
  });

  it("shows a dashboard-unavailable error state when the status request itself fails", async () => {
    stubFetch({ ok: false, status: 500, body: {} });

    render(<Dashboard />);

    await screen.findByText("Dashboard unavailable");
  });
});
