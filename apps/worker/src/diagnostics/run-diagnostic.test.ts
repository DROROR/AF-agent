import { describe, expect, it, vi } from "vitest";
import {
  capResponseBytes,
  classifyDyoProcess,
  runDiagnostic,
  WORKER_LOG_RELATIVE_PATH,
  type RunDiagnosticDeps
} from "./run-diagnostic.js";
import { DEFAULT_LOG_TAIL_LINES, MAX_LOG_TAIL_LINES } from "@dyo/schemas";

const workerId = "accd0a71-dbd6-4a53-8b81-d3fe4609420b";

function makeDeps(overrides: Partial<RunDiagnosticDeps> = {}): RunDiagnosticDeps {
  return {
    workerId,
    now: () => new Date("2026-09-12T14:30:00.000Z"),
    readTextTail: async (path) => ({ path, lines: ["a line"], truncated: false, note: null }),
    listDyoProcesses: async () => [],
    readDiskSpace: async () => [],
    probeAeMcpHealth: async () => ({ connected: true }),
    describeActiveJob: async () => ({ activeJob: null }),
    describeJobArtifacts: async () => ({ files: [] }),
    ...overrides
  };
}

describe("runDiagnostic", () => {
  it("reads the worker log tail from a FIXED path - the request never names a file", async () => {
    const readTextTail = vi.fn().mockResolvedValue({ path: "C:\\DYO-Agent\\app\\logs\\worker.log", lines: ["x"], truncated: false, note: null });
    const response = await runDiagnostic(makeDeps({ readTextTail }), { kind: "GET_WORKER_LOG_TAIL" });

    expect(readTextTail).toHaveBeenCalledWith(WORKER_LOG_RELATIVE_PATH, DEFAULT_LOG_TAIL_LINES);
    expect(response.ok).toBe(true);
    expect(response.text?.lines).toEqual(["x"]);
  });

  it("clamps an over-large tailLines request to the documented maximum", async () => {
    const readTextTail = vi.fn().mockResolvedValue({ path: "p", lines: [], truncated: false, note: null });
    // The schema rejects this at the boundary; this is the worker's own
    // independent defence, since the worker must never trust its input.
    await runDiagnostic(makeDeps({ readTextTail }), { kind: "GET_WORKER_LOG_TAIL", tailLines: 999_999 });
    expect(readTextTail).toHaveBeenCalledWith(WORKER_LOG_RELATIVE_PATH, MAX_LOG_TAIL_LINES);
  });

  it("REDACTS secrets out of log lines before they leave the machine", async () => {
    const readTextTail = async () => ({
      path: "p",
      lines: ['{"msg":"starting","workerToken":"9f3a2b1c4d5e6f708192a3b4c5d6e7f8091a2b3c"}'],
      truncated: false,
      note: null
    });
    const response = await runDiagnostic(makeDeps({ readTextTail }), { kind: "GET_WORKER_LOG_TAIL" });
    expect(JSON.stringify(response)).not.toContain("9f3a2b1c4d5e6f708192a3b4c5d6e7f8091a2b3c");
  });

  it("reports a missing previous log honestly instead of as an empty success", async () => {
    const readTextTail = async () => ({ path: null, lines: [], truncated: false, note: "file does not exist" });
    const response = await runDiagnostic(makeDeps({ readTextTail }), { kind: "GET_PREVIOUS_WORKER_LOG" });
    expect(response.text?.note).toBe("file does not exist");
  });

  it("summarises process command lines rather than echoing them", async () => {
    const listDyoProcesses = async () => [
      {
        processId: 17608,
        parentProcessId: 23884,
        name: "node.exe",
        commandLine: 'node --env-file=.env dist\\index.js --secret=abcdefghijklmnop',
        startedAt: "2026-09-12T14:09:28.000Z"
      }
    ];
    const response = await runDiagnostic(makeDeps({ listDyoProcesses }), { kind: "GET_DYO_PROCESS_TREE" });
    expect(response.processes?.[0]?.role).toBe("WORKER");
    expect(JSON.stringify(response)).not.toContain("abcdefghijklmnop");
  });

  it("redacts structured ae-mcp health detail", async () => {
    const probeAeMcpHealth = async () => ({ connected: true, authorization: "Bearer abcdefghijklmnopqrst" });
    const response = await runDiagnostic(makeDeps({ probeAeMcpHealth }), { kind: "GET_AE_MCP_HEALTH" });
    expect(response.detail?.["connected"]).toBe(true);
    expect(JSON.stringify(response)).not.toContain("abcdefghijklmnopqrst");
  });

  it("refuses GET_JOB_ARTIFACTS without a jobId rather than guessing one", async () => {
    const response = await runDiagnostic(makeDeps(), { kind: "GET_JOB_ARTIFACTS" });
    expect(response.ok).toBe(false);
    expect(response.failureReason).toContain("jobId");
  });

  it("NEVER throws - a failing collector becomes a structured ok:false", async () => {
    const listDyoProcesses = async () => {
      throw new Error("tasklist exploded");
    };
    const response = await runDiagnostic(makeDeps({ listDyoProcesses }), { kind: "GET_DYO_PROCESS_TREE" });
    expect(response.ok).toBe(false);
    expect(response.failureReason).toContain("tasklist exploded");
    expect(response.workerId).toBe(workerId);
  });

  it("bounds a collector that never settles instead of occupying the job slot forever", async () => {
    vi.useFakeTimers();
    try {
      const promise = runDiagnostic(makeDeps({ listDyoProcesses: () => new Promise(() => {}) }), {
        kind: "GET_DYO_PROCESS_TREE"
      });
      await vi.advanceTimersByTimeAsync(20_000);
      const response = await promise;
      expect(response.ok).toBe(false);
      expect(response.failureReason).toContain("did not settle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("classifyDyoProcess", () => {
  it.each([
    ["node dist\\supervisor\\index.js", "node.exe", "NODE_SUPERVISOR"],
    ["node --env-file=.env dist\\index.js", "node.exe", "WORKER"],
    ["node C:\\AI-Tools\\ae-mcp\\dist\\index.js serve", "node.exe", "AE_MCP"],
    ["", "AfterFX.exe", "AFTER_EFFECTS"],
    ["", "aerender.exe", "AERENDER"],
    ["notepad.exe", "notepad.exe", "OTHER"]
  ])("classifies %s as %s", (commandLine, name, expected) => {
    expect(classifyDyoProcess({ processId: 1, parentProcessId: null, name, commandLine, startedAt: null }).role).toBe(
      expected
    );
  });

  // The exact over-broad pattern that killed the ae-mcp bridge on 2026-09-11:
  // matching "dist\index.js" alone matches the bridge too.
  it("does NOT classify the ae-mcp bridge as the worker", () => {
    const record = { processId: 1, parentProcessId: null, name: "node.exe", commandLine: "node C:\\AI-Tools\\ae-mcp\\dist\\index.js serve", startedAt: null };
    expect(classifyDyoProcess(record).role).not.toBe("WORKER");
  });
});

describe("capResponseBytes", () => {
  it("keeps everything when under the ceiling", () => {
    expect(capResponseBytes(["a", "b"], 1000)).toEqual({ lines: ["a", "b"], truncated: false });
  });

  it("drops the OLDEST lines and flags truncation - an incident needs the newest", () => {
    const result = capResponseBytes(["oldest", "middle", "newest"], 14);
    expect(result.truncated).toBe(true);
    expect(result.lines.at(-1)).toBe("newest");
    expect(result.lines).not.toContain("oldest");
  });

  it("returns an empty, explicitly-truncated result rather than one oversized line", () => {
    expect(capResponseBytes(["x".repeat(100)], 10)).toEqual({ lines: [], truncated: true });
  });
});
