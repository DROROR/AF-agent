// @vitest-environment jsdom
import type { WorkerDto } from "@dyo/schemas";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerTable } from "./WorkerTable";

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
    render(<WorkerTable workers={null} now={now} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Worker data unavailable")).toBeTruthy();
  });

  it("renders an empty state when there are no workers", () => {
    render(<WorkerTable workers={[]} now={now} />);
    expect(screen.getByText("No workers registered")).toBeTruthy();
  });

  it("renders a row per worker with its identity and status fields", () => {
    render(<WorkerTable workers={[worker()]} now={now} />);
    expect(screen.getByText("worker-a")).toBeTruthy();
    expect(screen.getByText("11111111-1111-1111-1111-111111111111")).toBeTruthy();
    // Both the overall worker status and the AE status render "Online" here.
    expect(screen.getAllByText("Online")).toHaveLength(2);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByText("CHECK_HEALTH")).toBeTruthy();
  });

  it("shows a human-readable relative heartbeat time", () => {
    render(<WorkerTable workers={[worker()]} now={now} />);
    // lastHeartbeatAt is 8s before `now`.
    expect(screen.getByText("8 seconds ago")).toBeTruthy();
  });

  it('shows "never" when a worker has no lastHeartbeatAt yet', () => {
    render(<WorkerTable workers={[worker({ lastHeartbeatAt: null })]} now={now} />);
    expect(screen.getByText("never")).toBeTruthy();
  });

  it("shows an em-dash placeholder for missing optional fields", () => {
    render(<WorkerTable workers={[worker({ aeVersion: null, currentJobId: null, capabilities: [] })]} now={now} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
