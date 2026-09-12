import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AeMcpRoundTripAdapter, type HealthProbeClient } from "./ae-mcp-round-trip-adapter.js";
import realFahadnakashHealth from "./__fixtures__/ae-health-fahadnakash-2026-09-12.json" with { type: "json" };

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A real-looking ae-mcp install (only the one file the adapter checks for). */
function makeAeMcpInstall(): string {
  const root = mkdtempSync(join(tmpdir(), "ae-mcp-probe-test-"));
  cleanupDirs.push(root);
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "index.js"), "// fake ae-mcp entry point");
  return root;
}

/** The real confirmed ae_health content shape, as captured from job 04eb2159 on a real client machine. */
function healthContent(connected: boolean, listening = true): unknown {
  return [
    {
      type: "text",
      text: JSON.stringify({
        connected,
        ae_running: true,
        health: { connected, listening, aeVersion: "26.3x87", projectOpen: true, projectName: "working-copy.aep" }
      })
    }
  ];
}

interface FakeClientScript {
  connect?: () => Promise<void>;
  call?: () => Promise<{ ok: true; content: unknown } | { ok: false; error: { code: string; message: string } }>;
}

function fakeClientFactory(scripts: FakeClientScript[]): {
  create: (aeMcpPath: string, timeoutMs: number) => HealthProbeClient;
  created: number;
  closed: () => number;
} {
  let created = 0;
  let closed = 0;
  const factory = {
    create: (): HealthProbeClient => {
      const script = scripts[Math.min(created, scripts.length - 1)] ?? {};
      created += 1;
      factory.created = created;
      return {
        connect: script.connect ?? (async () => {}),
        callTool: script.call ?? (async () => ({ ok: true as const, content: healthContent(true) })),
        close: async () => {
          closed += 1;
        }
      };
    },
    created: 0,
    closed: () => closed
  };
  return factory;
}

describe("AeMcpRoundTripAdapter - the REAL captured FAHADNAKASH ae_health response", () => {
  it("accepts the exact verbatim response from the QA machine and reports ONLINE", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content: realFahadnakashHealth.content }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("ONLINE");
    expect(result.mcpProbeDetail).toBe("round-trip-ok");
  });

  it("accepts a response carrying ONLY the top-level connected flag - the over-strict rejection that produced a real 'unrecognized-health-shape' against a live bridge", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const noHealthObject = [{ type: "text", text: JSON.stringify({ connected: true, ae_running: true, instances: [] }) }];
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content: noHealthObject }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    expect((await adapter.checkHealth()).mcpStatus).toBe("ONLINE");
  });

  it("still reports OFFLINE from an explicit top-level connected:false, with no health object", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const content = [{ type: "text", text: JSON.stringify({ connected: false, ae_running: true }) }];
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    expect((await adapter.checkHealth()).mcpStatus).toBe("OFFLINE");
  });

  it("FALSE-ONLINE PROTECTION IS NOT WEAKENED: a response with no explicit connected flag anywhere is UNKNOWN, and names the keys it did see", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const content = [{ type: "text", text: JSON.stringify({ ae_running: true, instances: [], note: "something" }) }];
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProbeDetail).toMatch(/unrecognized-health-shape/);
    // Self-diagnosing: the observed keys are named so a real incident can be
    // read straight from worker.log, without another trip to the machine.
    expect(result.mcpProbeDetail).toMatch(/ae_running/);
  });
});

describe("AeMcpRoundTripAdapter - real 2026-09-12 incident: a healthy bridge reported UNKNOWN because the old CLI probe timed out at 8s", () => {
  it("reports ONLINE from a real round trip whose parsed response says the bridge is connected", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content: healthContent(true) }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("ONLINE");
    expect(result.mcpProbeDetail).toBe("round-trip-ok");
    expect(factory.closed()).toBe(1);
  });

  it("SLOW-BUT-HEALTHY BRIDGE: a probe that takes far longer than the old 8s ceiling still reports ONLINE, never UNKNOWN", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      {
        call: async () => {
          // Simulates upstream's own "ensure" work taking well past the old
          // hard ceiling - the exact condition that produced a permanent
          // false UNKNOWN on FAHADNAKASH.
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { ok: true, content: healthContent(true) };
        }
      }
    ]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("ONLINE");
  });

  it("reports OFFLINE (real evidence, not UNKNOWN) when the bridge answers but says it is not connected", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content: healthContent(false) }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("OFFLINE");
    expect(result.mcpProbeDetail).toBe("bridge-not-connected");
  });

  it("PROBE TIMEOUT: retries a bounded number of times, then reports UNKNOWN naming the real mechanism - never an unbounded loop", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      { connect: async () => { throw new Error("timed out"); } }
    ]);
    const sleep = vi.fn(async () => {});
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create, maxAttempts: 3, sleep });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProbeDetail).toBe("connect-failed-after-3-attempts");
    // Bounded: exactly the configured number of attempts, never more.
    expect(factory.created).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("DISCONNECT THEN RECONNECT: a transient failure on the first attempt still resolves to ONLINE on the retry", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      { connect: async () => { throw new Error("bridge restarting"); } },
      { call: async () => ({ ok: true, content: healthContent(true) }) }
    ]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create, maxAttempts: 2, sleep: async () => {} });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("ONLINE");
  });

  it("never reports a false ONLINE when the response parses but is not the confirmed shape", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      { call: async () => ({ ok: true, content: [{ type: "text", text: JSON.stringify({ something: "else" }) }] }) }
    ]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProbeDetail).toMatch(/^unrecognized-health-shape/);
  });

  it("caches a confirmed-ONLINE answer briefly instead of spawning a bridge process on every heartbeat", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content: healthContent(true) }) }]);
    let clock = 1_000;
    const adapter = new AeMcpRoundTripAdapter({
      aeMcpPath,
      createClient: factory.create,
      onlineCacheTtlMs: 60_000,
      now: () => clock
    });

    const first = await adapter.checkHealth();
    clock += 10_000;
    const second = await adapter.checkHealth();

    expect(first.mcpStatus).toBe("ONLINE");
    expect(second.mcpStatus).toBe("ONLINE");
    expect(second.mcpProbeDetail).toBe("round-trip-ok-cached");
    // Only ONE real probe happened across both calls.
    expect(factory.created).toBe(1);
  });

  it("re-probes eagerly (never serves a cached answer) once the last result was not ONLINE", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      { call: async () => ({ ok: true, content: healthContent(false) }) },
      { call: async () => ({ ok: true, content: healthContent(true) }) }
    ]);
    let clock = 1_000;
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create, now: () => clock });

    expect((await adapter.checkHealth()).mcpStatus).toBe("OFFLINE");
    clock += 1_000;
    expect((await adapter.checkHealth()).mcpStatus).toBe("ONLINE");
    expect(factory.created).toBe(2);
  });

  it("COLD BOOT: reports UNKNOWN with a configuration-specific reason when ae-mcp is not installed where configured - never OFFLINE, which would wrongly blame the bridge", async () => {
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath: join(tmpdir(), "definitely-not-installed-here") });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProbeDetail).toBe("script-missing");
  });

  it("reports UNKNOWN/not-configured, and never spawns anything, when AE_MCP_PATH is unset", async () => {
    const factory = fakeClientFactory([]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath: undefined, createClient: factory.create });

    const result = await adapter.checkHealth();

    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProbeDetail).toBe("not-configured");
    expect(factory.created).toBe(0);
  });

  it("never runs two probes at once - a second call while one is in flight shares the same result", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      {
        call: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { ok: true, content: healthContent(true) };
        }
      }
    ]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const [a, b] = await Promise.all([adapter.checkHealth(), adapter.checkHealth()]);

    expect(a.mcpStatus).toBe("ONLINE");
    expect(b.mcpStatus).toBe("ONLINE");
    expect(factory.created).toBe(1);
  });
});
