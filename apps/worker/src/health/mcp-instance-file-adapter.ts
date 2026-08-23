import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpStatus } from "@dyo/schemas";
import type { McpAdapter, McpHealthResult } from "./mcp-adapter.js";

/**
 * ae-mcp per-instance state file - schema confirmed against a real client
 * sample (Phase 4, 2026-08-23):
 *   {
 *     "instanceId": "default",
 *     "aeVersion": "26.3x87",
 *     "projectName": "Untitled",
 *     "projectPath": null,
 *     "lastSeen": "2026-08-23T09:18:12Z",
 *     "pollMs": 1500,
 *     "protocolVersion": 1,
 *     "listening": true
 *   }
 * Path is confirmed distinct from the ae-mcp *installation* path
 * (AE_MCP_PATH, C:\AI-Tools\ae-mcp) - the real instance file lives at
 * C:\Users\PC\ae-mcp\instances\default\instance.json, configured
 * independently via AE_MCP_INSTANCE_FILE_PATH.
 */
const instanceFileSchema = z.object({
  instanceId: z.string(),
  aeVersion: z.string(),
  projectName: z.string(),
  projectPath: z.string().nullable(),
  lastSeen: z.string(),
  pollMs: z.number().positive(),
  protocolVersion: z.number().int(),
  listening: z.boolean()
});

type InstanceFile = z.infer<typeof instanceFileSchema>;

/**
 * Only protocolVersion 1 has been confirmed against a real sample. Bump
 * this once a newer version has actually been confirmed compatible - never
 * assume forward compatibility from an unrecognized version number, per
 * "never fabricate MCP health".
 */
const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

/** Five missed polls, with a 10s floor so a very fast pollMs doesn't make the check overly twitchy. */
function computeStaleAfterMs(pollMs: number): number {
  return Math.max(pollMs * 5, 10_000);
}

/**
 * Maps a schema-valid instance file to a status. An unsupported
 * protocolVersion or an unparseable lastSeen is treated the same as a
 * schema-validation failure (UNKNOWN) - the file exists and parses as
 * JSON, but its content can't be trusted to mean what we assume it means.
 */
function interpretInstanceFile(file: InstanceFile, now: Date): McpStatus {
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(file.protocolVersion)) {
    return "UNKNOWN";
  }

  const lastSeenAt = new Date(file.lastSeen);
  if (Number.isNaN(lastSeenAt.getTime())) {
    return "UNKNOWN";
  }

  if (!file.listening) {
    return "OFFLINE";
  }

  const isStale = now.getTime() - lastSeenAt.getTime() > computeStaleAfterMs(file.pollMs);
  return isStale ? "OFFLINE" : "ONLINE";
}

export interface McpInstanceFileAdapterConfig {
  instanceFilePath: string | undefined;
  /** Injectable clock for deterministic staleness tests. Defaults to the real clock. */
  now?: () => Date;
}

export class McpInstanceFileAdapter implements McpAdapter {
  private readonly instanceFilePath: string | undefined;
  private readonly now: () => Date;

  constructor(config: McpInstanceFileAdapterConfig) {
    this.instanceFilePath = config.instanceFilePath;
    this.now = config.now ?? (() => new Date());
  }

  async checkHealth(): Promise<McpHealthResult> {
    const path = this.instanceFilePath;
    if (!path) {
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: null };
    }

    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      // Missing/unreadable file is not evidence of OFFLINE - it's simply
      // not enough evidence either way, same rule as the AE process check
      // in ae-health.ts.
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: path };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: path };
    }

    const result = instanceFileSchema.safeParse(parsed);
    if (!result.success) {
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: path };
    }

    return { mcpStatus: interpretInstanceFile(result.data, this.now()), mcpConfiguredPath: path };
  }
}
