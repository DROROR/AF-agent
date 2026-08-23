import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpInstanceFileAdapter } from "./mcp-instance-file-adapter.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-mcp-instance-"));
  path = join(dir, "instance.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
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

async function writeInstanceFile(content: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(content), "utf8");
}

describe("McpInstanceFileAdapter - file boundary", () => {
  it("reports UNKNOWN with a null path when no instance file is configured", async () => {
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: undefined });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "UNKNOWN", mcpConfiguredPath: null });
  });

  it("reports UNKNOWN (not OFFLINE) when the configured file does not exist", async () => {
    const missingPath = join(dir, "does-not-exist.json");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: missingPath });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "UNKNOWN", mcpConfiguredPath: missingPath });
  });

  it("reports UNKNOWN when the file exists but is not valid JSON", async () => {
    await writeFile(path, "not valid json{{{", "utf8");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("reports UNKNOWN when the file is a valid JSON array rather than an object", async () => {
    await writeFile(path, "[1, 2, 3]", "utf8");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("reports UNKNOWN when a required field is missing", async () => {
    const withoutListening: Partial<typeof REAL_CLIENT_SAMPLE> = { ...REAL_CLIENT_SAMPLE };
    delete withoutListening.listening;
    await writeInstanceFile(withoutListening);
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });
});

describe("McpInstanceFileAdapter - status mapping (real client sample as regression fixture)", () => {
  it("reports ONLINE for the real sample when lastSeen is fresh relative to injected now", async () => {
    await writeInstanceFile(REAL_CLIENT_SAMPLE);
    // 1s after lastSeen - well within staleAfterMs (max(1500*5, 10000) = 10000).
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path, now });
    const result = await adapter.checkHealth();
    expect(result).toEqual({ mcpStatus: "ONLINE", mcpConfiguredPath: path });
  });

  it("reports OFFLINE for the real sample shape when listening is false, even if lastSeen is fresh", async () => {
    await writeInstanceFile({ ...REAL_CLIENT_SAMPLE, listening: false });
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("OFFLINE");
  });

  it("reports OFFLINE when listening is true but lastSeen is stale", async () => {
    await writeInstanceFile(REAL_CLIENT_SAMPLE);
    // 11s after lastSeen - past staleAfterMs (10000ms floor for pollMs=1500).
    const now = () => new Date("2026-08-23T09:18:23Z");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("OFFLINE");
  });

  it("uses the pollMs*5 floor: exactly at the boundary is not yet stale", async () => {
    await writeInstanceFile(REAL_CLIENT_SAMPLE);
    // Exactly 10000ms after lastSeen - staleness is a strict ">", so this is still fresh.
    const now = () => new Date("2026-08-23T09:18:22Z");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("ONLINE");
  });

  it("uses pollMs*5 rather than the 10s floor when pollMs is large enough to dominate", async () => {
    await writeInstanceFile({ ...REAL_CLIENT_SAMPLE, pollMs: 4000 });
    // staleAfterMs = max(4000*5, 10000) = 20000. 15s after lastSeen: fresh under the
    // 20s pollMs-derived threshold, even though it would be stale under the 10s floor.
    const now = () => new Date("2026-08-23T09:18:27Z");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("ONLINE");
  });

  it("reports UNKNOWN for an unsupported protocolVersion, never fabricating ONLINE/OFFLINE", async () => {
    await writeInstanceFile({ ...REAL_CLIENT_SAMPLE, protocolVersion: 2 });
    const now = () => new Date("2026-08-23T09:18:13Z");
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path, now });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("reports UNKNOWN when lastSeen is not a parseable timestamp", async () => {
    await writeInstanceFile({ ...REAL_CLIENT_SAMPLE, lastSeen: "not-a-timestamp" });
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("UNKNOWN");
  });

  it("defaults to the real clock when now is not injected", async () => {
    await writeInstanceFile({ ...REAL_CLIENT_SAMPLE, lastSeen: new Date().toISOString(), listening: true });
    const adapter = new McpInstanceFileAdapter({ instanceFilePath: path });
    const result = await adapter.checkHealth();
    expect(result.mcpStatus).toBe("ONLINE");
  });
});
