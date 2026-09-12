import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AeMcpRoundTripAdapter, type HealthProbeClient } from "./ae-mcp-round-trip-adapter.js";
import { REAL_FAHADNAKASH_AE_HEALTH_CONTENT } from "./__fixtures__/ae-health-fahadnakash-2026-09-12.js";

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

/**
 * checkHealth() deliberately never blocks (2026-09-12 fix - a hanging probe
 * used to stop the worker registering at all), so a test that wants the real
 * probe outcome must let the background probe finish and then read it.
 */
async function settledHealth(adapter: AeMcpRoundTripAdapter, waitMs = 200) {
  await adapter.checkHealth();
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return adapter.checkHealth();
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

describe("AeMcpRoundTripAdapter - real 2026-09-12 oscillation: mcpStatus flapped UNKNOWN -> ONLINE -> UNKNOWN on a machine whose bridge was up throughout", () => {
  it("holds a confirmed ONLINE through isolated failed probes instead of flapping - one failed spawn is not evidence the bridge died", async () => {
    const aeMcpPath = makeAeMcpInstall();
    let clock = 1_000;
    const factory = fakeClientFactory([
      { call: async () => ({ ok: true, content: healthContent(true) }) },
      { connect: async () => { throw new Error("spawn failed"); } }
    ]);
    const adapter = new AeMcpRoundTripAdapter({
      aeMcpPath,
      createClient: factory.create,
      now: () => clock,
      sleep: async () => {},
      onlineCacheTtlMs: 1
    });

    expect((await settledHealth(adapter)).mcpStatus).toBe("ONLINE");
    clock += 10_000;
    const held = await settledHealth(adapter);

    // The failed probe is recorded, but the last REAL observation still stands.
    expect(held.mcpStatus).toBe("ONLINE");
    expect(held.mcpProbeDetail).toMatch(/holding\(1\/3/);
  });

  it("downgrades to UNKNOWN once enough consecutive probes fail - a genuine outage is never masked indefinitely", async () => {
    const aeMcpPath = makeAeMcpInstall();
    let clock = 1_000;
    const factory = fakeClientFactory([
      { call: async () => ({ ok: true, content: healthContent(true) }) },
      { connect: async () => { throw new Error("spawn failed"); } }
    ]);
    const adapter = new AeMcpRoundTripAdapter({
      aeMcpPath,
      createClient: factory.create,
      now: () => clock,
      sleep: async () => {},
      onlineCacheTtlMs: 1,
      failuresBeforeDowngrade: 2
    });

    expect((await settledHealth(adapter)).mcpStatus).toBe("ONLINE");
    clock += 10_000;
    expect((await settledHealth(adapter)).mcpStatus).toBe("ONLINE");   // 1st failure held
    clock += 10_000;
    expect((await settledHealth(adapter)).mcpStatus).toBe("UNKNOWN");  // 2nd failure downgrades
  });

  it("an explicit bridge-not-connected answer is REAL evidence and is never debounced", async () => {
    const aeMcpPath = makeAeMcpInstall();
    let clock = 1_000;
    const factory = fakeClientFactory([
      { call: async () => ({ ok: true, content: healthContent(true) }) },
      { call: async () => ({ ok: true, content: healthContent(false) }) }
    ]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create, now: () => clock, onlineCacheTtlMs: 1 });

    expect((await settledHealth(adapter)).mcpStatus).toBe("ONLINE");
    clock += 10_000;
    // The bridge itself says it is down - reported immediately, not held.
    expect((await settledHealth(adapter)).mcpStatus).toBe("OFFLINE");
  });
});

describe("AeMcpRoundTripAdapter - real 2026-09-12 incident: a hanging probe stopped the worker registering at all", () => {
  it("NEVER BLOCKS: a probe whose connect never resolves still returns immediately, so the first heartbeat can be sent", async () => {
    const aeMcpPath = makeAeMcpInstall();
    let terminatedWith: string | null = null;
    const neverResolving: HealthProbeClient = {
      connect: () => new Promise<void>(() => {}),        // never settles, ever
      callTool: () => new Promise(() => {}),
      close: async () => {},
      terminate: async (reason: string) => {
        terminatedWith = reason;
      }
    };
    const adapter = new AeMcpRoundTripAdapter({
      aeMcpPath,
      createClient: () => neverResolving,
      hardDeadlineMs: 40
    });

    // The real regression: this used to await the probe forever, so the
    // worker logged "worker starting" and then went silent indefinitely.
    const first = await Promise.race([
      adapter.checkHealth(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("checkHealth blocked")), 1_000))
    ]);

    expect(first.mcpStatus).toBe("UNKNOWN");
    expect(first.mcpProbeDetail).toBe("probe-pending");

    // The abandoned probe force-kills its own ae-mcp child rather than
    // orphaning it.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(terminatedWith).toMatch(/hard deadline/i);
  });

  it("reports the hard-deadline outcome on the NEXT heartbeat, never a status it has not observed", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const adapter = new AeMcpRoundTripAdapter({
      aeMcpPath,
      createClient: () => ({ connect: () => new Promise<void>(() => {}), callTool: () => new Promise(() => {}), close: async () => {} }),
      hardDeadlineMs: 30
    });

    expect((await adapter.checkHealth()).mcpProbeDetail).toBe("probe-pending");
    await new Promise((resolve) => setTimeout(resolve, 120));
    const second = await adapter.checkHealth();

    expect(second.mcpStatus).toBe("UNKNOWN");
    expect(second.mcpProbeDetail).toMatch(/^hard-deadline-/);
  });

  it("a slow-but-successful probe eventually reports ONLINE on a later heartbeat", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      {
        call: async () => {
          await new Promise((resolve) => setTimeout(resolve, 40));
          return { ok: true, content: healthContent(true) };
        }
      }
    ]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    expect((await adapter.checkHealth()).mcpProbeDetail).toBe("probe-pending");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const later = await adapter.checkHealth();

    expect(later.mcpStatus).toBe("ONLINE");
    expect(later.mcpProbeDetail).toMatch(/round-trip-ok/);
  });
});

describe("AeMcpRoundTripAdapter - the REAL captured FAHADNAKASH ae_health response", () => {
  it("accepts the exact verbatim response from the QA machine and reports ONLINE", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content: REAL_FAHADNAKASH_AE_HEALTH_CONTENT }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await settledHealth(adapter);

    expect(result.mcpStatus).toBe("ONLINE");
    expect(result.mcpProbeDetail).toMatch(/^round-trip-ok/);
  });

  it("accepts a response carrying ONLY the top-level connected flag - the over-strict rejection that produced a real 'unrecognized-health-shape' against a live bridge", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const noHealthObject = [{ type: "text", text: JSON.stringify({ connected: true, ae_running: true, instances: [] }) }];
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content: noHealthObject }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    expect((await settledHealth(adapter)).mcpStatus).toBe("ONLINE");
  });

  it("still reports OFFLINE from an explicit top-level connected:false, with no health object", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const content = [{ type: "text", text: JSON.stringify({ connected: false, ae_running: true }) }];
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    expect((await settledHealth(adapter)).mcpStatus).toBe("OFFLINE");
  });

  it("FALSE-ONLINE PROTECTION IS NOT WEAKENED: a response with no explicit connected flag anywhere is UNKNOWN, and names the keys it did see", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const content = [{ type: "text", text: JSON.stringify({ ae_running: true, instances: [], note: "something" }) }];
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await settledHealth(adapter);

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

    const result = await settledHealth(adapter);

    expect(result.mcpStatus).toBe("ONLINE");
    expect(result.mcpProbeDetail).toMatch(/^round-trip-ok/);
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

    const result = await settledHealth(adapter);

    expect(result.mcpStatus).toBe("ONLINE");
  });

  it("reports OFFLINE (real evidence, not UNKNOWN) when the bridge answers but says it is not connected", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([{ call: async () => ({ ok: true, content: healthContent(false) }) }]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await settledHealth(adapter);

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

    await adapter.checkHealth();
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Bounded: exactly the configured number of attempts for THIS probe,
    // asserted before any later read can start a fresh one.
    expect(factory.created).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
    expect(result.mcpProbeDetail).toBe("connect-failed-after-3-attempts");
  });

  it("DISCONNECT THEN RECONNECT: a transient failure on the first attempt still resolves to ONLINE on the retry", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      { connect: async () => { throw new Error("bridge restarting"); } },
      { call: async () => ({ ok: true, content: healthContent(true) }) }
    ]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create, maxAttempts: 2, sleep: async () => {} });

    const result = await settledHealth(adapter);

    expect(result.mcpStatus).toBe("ONLINE");
  });

  it("never reports a false ONLINE when the response parses but is not the confirmed shape", async () => {
    const aeMcpPath = makeAeMcpInstall();
    const factory = fakeClientFactory([
      { call: async () => ({ ok: true, content: [{ type: "text", text: JSON.stringify({ something: "else" }) }] }) }
    ]);
    const adapter = new AeMcpRoundTripAdapter({ aeMcpPath, createClient: factory.create });

    const result = await settledHealth(adapter);

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

    const first = await settledHealth(adapter);
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

    expect((await settledHealth(adapter)).mcpStatus).toBe("OFFLINE");
    clock += 1_000;
    expect((await settledHealth(adapter)).mcpStatus).toBe("ONLINE");
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
    // Both return immediately without blocking, and only ONE probe was started.
    expect(a.mcpProbeDetail).toBe("probe-pending");
    expect(b.mcpProbeDetail).toBe("probe-pending");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await adapter.checkHealth()).mcpStatus).toBe("ONLINE");
    expect(factory.created).toBe(1);
  });
});
