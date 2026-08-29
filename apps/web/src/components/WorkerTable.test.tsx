// @vitest-environment jsdom
import type { WorkerDto } from "@dyo/schemas";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerTable } from "./WorkerTable";
import { renderWithLocale } from "../test-utils/render-with-locale";

afterEach(cleanup);

const now = new Date("2026-01-01T00:00:10.000Z");

function worker(overrides: Partial<WorkerDto> = {}): WorkerDto {
  return {
    workerId: "11111111-1111-1111-1111-111111111111",
    name: "worker-a",
    status: "ONLINE",
    lastHeartbeatAt: "2026-01-01T00:00:02.000Z",
    aeStatus: "ONLINE",
    mcpStatus: "UNKNOWN",
    aeAvailability: "ONLINE",
    mcpAvailability: "UNKNOWN",
    aeVersion: "2026",
    capabilities: ["CHECK_HEALTH"],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:05.000Z",
    ...overrides
  };
}

describe("WorkerTable", () => {
  it("renders an error state when the worker list is unavailable (null)", () => {
    renderWithLocale(<WorkerTable workers={null} now={now} />);
    // getByRole/getByText already throw if nothing matches, so a bare call
    // is the assertion - no need to additionally wrap it in expect().
    screen.getByRole("alert");
    screen.getByText("Worker data unavailable");
  });

  it("renders an empty state when there are no workers", () => {
    renderWithLocale(<WorkerTable workers={[]} now={now} />);
    screen.getByText("No workers registered");
  });

  it("renders a row per worker with its identity and status fields", () => {
    renderWithLocale(<WorkerTable workers={[worker()]} now={now} />);
    screen.getByText("worker-a");
    // Both the overall worker status and the AE status render "Online" here.
    expect(screen.getAllByText("Online")).toHaveLength(2);
    screen.getByText("Unknown");
    screen.getByText("2026");
    screen.getByText("CHECK_HEALTH");
  });

  it("is not clickable and has no onClick behavior when onSelectWorker is not provided", () => {
    renderWithLocale(<WorkerTable workers={[worker()]} now={now} />);
    const row = screen.getByText("worker-a").closest("tr");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-clickable")).toBeNull();
    expect(row?.getAttribute("tabIndex")).toBeNull();
  });

  it("calls onSelectWorker with the worker when its row is clicked", () => {
    const onSelectWorker = vi.fn();
    renderWithLocale(<WorkerTable workers={[worker()]} now={now} onSelectWorker={onSelectWorker} />);
    const row = screen.getByText("worker-a").closest("tr");
    expect(row?.getAttribute("data-clickable")).toBe("true");
    fireEvent.click(row as HTMLElement);
    expect(onSelectWorker).toHaveBeenCalledTimes(1);
    expect(onSelectWorker).toHaveBeenCalledWith(expect.objectContaining({ workerId: "11111111-1111-1111-1111-111111111111" }));
  });

  it("calls onSelectWorker on Enter/Space for keyboard accessibility", () => {
    const onSelectWorker = vi.fn();
    renderWithLocale(<WorkerTable workers={[worker()]} now={now} onSelectWorker={onSelectWorker} />);
    const row = screen.getByText("worker-a").closest("tr") as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onSelectWorker).toHaveBeenCalledTimes(2);
  });

  it("shows a human-readable relative heartbeat time", () => {
    renderWithLocale(<WorkerTable workers={[worker()]} now={now} />);
    // lastHeartbeatAt is 8s before `now`.
    screen.getByText("8 seconds ago");
  });

  it('shows "never" when a worker has no lastHeartbeatAt yet', () => {
    renderWithLocale(<WorkerTable workers={[worker({ lastHeartbeatAt: null })]} now={now} />);
    screen.getByText("never");
  });

  it("shows an em-dash placeholder for missing optional fields", () => {
    renderWithLocale(<WorkerTable workers={[worker({ aeVersion: null, currentJobId: null, capabilities: [] })]} now={now} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it("never shows AE/MCP as Online once the Worker itself is offline, even when the last-reported telemetry was Online (stale-green regression)", () => {
    renderWithLocale(
      <WorkerTable
        workers={[
          worker({
            status: "OFFLINE",
            aeStatus: "ONLINE",
            mcpStatus: "ONLINE",
            aeAvailability: "UNAVAILABLE",
            mcpAvailability: "UNAVAILABLE"
          })
        ]}
        now={now}
      />
    );

    // The overall Worker status still renders its own real "Offline".
    expect(screen.getByText("Offline")).toBeTruthy();
    // Both AE and MCP render "Unavailable" - never the stale "Online" that
    // aeStatus/mcpStatus still carry.
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText("Online")).toBeNull();
  });

  it("surfaces the last-reported telemetry only as secondary metadata (a title attribute), never as the primary badge", () => {
    renderWithLocale(
      <WorkerTable
        workers={[
          worker({
            status: "OFFLINE",
            aeStatus: "ONLINE",
            mcpStatus: "ONLINE",
            aeAvailability: "UNAVAILABLE",
            mcpAvailability: "UNAVAILABLE",
            lastHeartbeatAt: "2026-01-01T00:00:00.000Z"
          })
        ]}
        now={now}
      />
    );

    const cells = screen.getAllByText("Unavailable").map((el) => el.closest("td"));
    for (const cell of cells) {
      expect(cell?.getAttribute("title")).toContain("Online");
      expect(cell?.getAttribute("title")).toContain("10 seconds ago");
    }
  });
});
