// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardStatusProvider } from "./DashboardStatusProvider";
import { WorkersPage } from "./WorkersPage";
import { renderWithLocale } from "../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
  );
}

describe("WorkersPage", () => {
  it("renders the worker table and opens a detail drawer with the real worker's data on row click", async () => {
    stubFetch({
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
    });

    renderWithLocale(
      <DashboardStatusProvider>
        <WorkersPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("worker-a");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByText("worker-a"));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("11111111-1111-1111-1111-111111111111");
  });

  it("shows an empty state when there are no workers", async () => {
    stubFetch({ api: "ok", database: "ok", workers: [], fetchedAt: new Date().toISOString() });

    renderWithLocale(
      <DashboardStatusProvider>
        <WorkersPage />
      </DashboardStatusProvider>
    );

    await screen.findByText("No workers registered");
  });
});
