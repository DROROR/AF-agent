import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpInstanceFileAdapter } from "./mcp-instance-file-adapter.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "dyo-mcp-datadir-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Real client sample, Phase 4, 2026-08-23 - used verbatim as a regression fixture. */
const REAL_CLIENT_SAMPLE = {
  instanceId: "default",
  aeVersion: "26.3x87",
  projectName: "Untitled",
  projectPath: null,
  lastSeen: "2026-08-23T09:18:12Z",
  pollMs: 1500,
  protocolVersion: 1,
  listening: true
};

/** Writes <dataDir>/instances/<instanceDirName>/instance.json - the real upstream ae-mcp layout. */
async function writeInstance(instanceDirName: string, content: unknown): Promise<string> {
  const instanceDir = join(dataDir, "instances", instanceDirName);
  await mkdir(instanceDir, { recursive: true });
  const filePath = join(instanceDir, "instance.json");
  await writeFile(filePath, JSON.stringify(content), "utf8");
  return filePath;
}

describe("McpInstanceFileAdapter - discovery", () => {
  it("reports UNKNOWN, scanning <dataDir>/instances, when the data dir does not exist at all", async () => {
    const missingDataDir = join(dataDir, "does-not-exist");
    const adapter = new McpInstanceFileAdapter({ dataDir: missingDataDir });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "UNKNOWN", mcpConfiguredPath: join(missingDataDir, "instances") });
  });

  it("reports UNKNOWN when <dataDir>/instances/ exists but has no subdirectories", async () => {
    await mkdir(join(dataDir, "instances"), { recursive: true });
    const adapter = new McpInstanceFileAdapter({ dataDir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("never hardcodes a single 'default' instance - discovers a non-default instance ID too", async () => {
    const filePath = await writeInstance("my-custom-instance", REAL_CLIENT_SAMPLE);
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "ONLINE", mcpConfiguredPath: filePath });
  });

  it("prefers a fresh, live 'default' instance over other live instances", async () => {
    await writeInstance("other-instance", { ...REAL_CLIENT_SAMPLE, instanceId: "other-instance" });
    const defaultPath = await writeInstance("default", REAL_CLIENT_SAMPLE);
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "ONLINE", mcpConfiguredPath: defaultPath });
  });

  it("falls back to the freshest live instance when there is no live 'default'", async () => {
    // "default" exists but is not listening - must not be selected even though it exists.
    await writeInstance("default", { ...REAL_CLIENT_SAMPLE, listening: false });
    await writeInstance("older-live", {
      ...REAL_CLIENT_SAMPLE,
      instanceId: "older-live",
      lastSeen: "2026-08-23T09:18:10Z"
    });
    const freshestLivePath = await writeInstance("freshest-live", {
      ...REAL_CLIENT_SAMPLE,
      instanceId: "freshest-live",
      lastSeen: "2026-08-23T09:18:12Z"
    });
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "ONLINE", mcpConfiguredPath: freshestLivePath });
  });

  it("reports OFFLINE (not UNKNOWN) when a structurally-valid instance exists but none is currently live", async () => {
    const filePath = await writeInstance("default", { ...REAL_CLIENT_SAMPLE, listening: false });
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "OFFLINE", mcpConfiguredPath: filePath });
  });

  it("skips a malformed instance directory and still finds a valid one alongside it", async () => {
    await mkdir(join(dataDir, "instances", "broken"), { recursive: true });
    await writeFile(join(dataDir, "instances", "broken", "instance.json"), "not valid json{{{", "utf8");
    const goodPath = await writeInstance("default", REAL_CLIENT_SAMPLE);
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "ONLINE", mcpConfiguredPath: goodPath });
  });

  it("reports UNKNOWN when every discovered instance directory is malformed", async () => {
    await mkdir(join(dataDir, "instances", "broken"), { recursive: true });
    await writeFile(join(dataDir, "instances", "broken", "instance.json"), "not valid json{{{", "utf8");
    const adapter = new McpInstanceFileAdapter({ dataDir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });
});

describe("McpInstanceFileAdapter - per-file validation (real client sample as regression fixture)", () => {
  it("reports UNKNOWN when the file is a valid JSON array rather than an object", async () => {
    await mkdir(join(dataDir, "instances", "default"), { recursive: true });
    await writeFile(join(dataDir, "instances", "default", "instance.json"), "[1, 2, 3]", "utf8");
    const adapter = new McpInstanceFileAdapter({ dataDir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("reports UNKNOWN when a required field is missing", async () => {
    const withoutListening: Partial<typeof REAL_CLIENT_SAMPLE> = { ...REAL_CLIENT_SAMPLE };
    delete withoutListening.listening;
    await writeInstance("default", withoutListening);
    const adapter = new McpInstanceFileAdapter({ dataDir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("reports UNKNOWN for an unsupported protocolVersion, never fabricating ONLINE/OFFLINE", async () => {
    await writeInstance("default", { ...REAL_CLIENT_SAMPLE, protocolVersion: 2 });
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("reports UNKNOWN when lastSeen is not a parseable timestamp", async () => {
    await writeInstance("default", { ...REAL_CLIENT_SAMPLE, lastSeen: "not-a-timestamp" });
    const adapter = new McpInstanceFileAdapter({ dataDir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });
});

describe("McpInstanceFileAdapter - staleness math (unchanged from the single-file version)", () => {
  it("reports ONLINE for the real sample when lastSeen is fresh relative to injected now", async () => {
    const filePath = await writeInstance("default", REAL_CLIENT_SAMPLE);
    // 1s after lastSeen - well within staleAfterMs (max(1500*5, 10000) = 10000).
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "ONLINE", mcpConfiguredPath: filePath });
  });

  it("reports OFFLINE for the real sample shape when listening is false, even if lastSeen is fresh", async () => {
    await writeInstance("default", { ...REAL_CLIENT_SAMPLE, listening: false });
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("OFFLINE");
  });

  it("reports OFFLINE when listening is true but lastSeen is stale", async () => {
    await writeInstance("default", REAL_CLIENT_SAMPLE);
    // 11s after lastSeen - past staleAfterMs (10000ms floor for pollMs=1500).
    const now = () => new Date("2026-08-23T09:18:23Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("OFFLINE");
  });

  it("uses the pollMs*5 floor: exactly at the boundary is not yet stale", async () => {
    await writeInstance("default", REAL_CLIENT_SAMPLE);
    // Exactly 10000ms after lastSeen - staleness is a strict ">", so this is still fresh.
    const now = () => new Date("2026-08-23T09:18:22Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("ONLINE");
  });

  it("uses pollMs*5 rather than the 10s floor when pollMs is large enough to dominate", async () => {
    await writeInstance("default", { ...REAL_CLIENT_SAMPLE, pollMs: 4000 });
    // staleAfterMs = max(4000*5, 10000) = 20000. 15s after lastSeen: fresh under the
    // 20s pollMs-derived threshold, even though it would be stale under the 10s floor.
    const now = () => new Date("2026-08-23T09:18:27Z");
    const adapter = new McpInstanceFileAdapter({ dataDir, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("ONLINE");
  });

  it("defaults to the real clock when now is not injected", async () => {
    await writeInstance("default", { ...REAL_CLIENT_SAMPLE, lastSeen: new Date().toISOString(), listening: true });
    const adapter = new McpInstanceFileAdapter({ dataDir });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("ONLINE");
  });
});
