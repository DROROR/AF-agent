// @vitest-environment jsdom
import type { WorkerDto } from "@dyo/schemas";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerDetailDrawer } from "./WorkerDetailDrawer";
import { renderWithLocale } from "../test-utils/render-with-locale";

afterEach(cleanup);

function worker(overrides: Partial<WorkerDto> = {}): WorkerDto {
  return {
    workerId: "11111111-1111-1111-1111-111111111111",
    name: "worker-a",
    status: "ONLINE",
    lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    aeAvailability: "ONLINE",
    mcpAvailability: "ONLINE",
    aeVersion: "2026",
    capabilities: ["CHECK_HEALTH"],
    maxConcurrency: 1,
    currentJobId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("WorkerDetailDrawer", () => {
  it("renders all three as Online when the worker is healthy and AE/MCP both report ONLINE (scenario B)", () => {
    renderWithLocale(<WorkerDetailDrawer worker={worker()} onClose={vi.fn()} />);
    expect(screen.getAllByText("Online")).toHaveLength(3);
    expect(screen.queryByText("Unavailable")).toBeNull();
  });

  it("shows AE/MCP as Unavailable (never Online) once the worker is offline, plus the offline notice and last-known secondary text (scenario A)", () => {
    renderWithLocale(
      <WorkerDetailDrawer
        worker={worker({ status: "OFFLINE", aeStatus: "ONLINE", mcpStatus: "ONLINE", aeAvailability: "UNAVAILABLE", mcpAvailability: "UNAVAILABLE" })}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText("Online")).toBeNull();
    screen.getByText("Worker is offline — current status cannot be verified.");
    expect(screen.getAllByText(/Last known: Online/)).toHaveLength(2);
  });

  it("reports the exact real per-signal statuses when the worker is online but AE itself is offline (scenario C)", () => {
    renderWithLocale(<WorkerDetailDrawer worker={worker({ aeStatus: "OFFLINE", aeAvailability: "OFFLINE" })} onClose={vi.fn()} />);

    expect(screen.getAllByText("Online")).toHaveLength(2);
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.queryByText("Worker is offline — current status cannot be verified.")).toBeNull();
  });
});
