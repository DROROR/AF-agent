import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpAdapter, McpHealthResult } from "./mcp-adapter.js";

/**
 * ae-mcp per-instance heartbeat file schema - confirmed against a real
 * client sample (Phase 4, 2026-08-23):
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
 *
 * Location - confirmed against the real upstream HeroicSwan/after-effects-mcp
 * implementation, not assumed: ae-mcp's data root is `os.homedir() +
 * ".ae-mcp"` (see env.ts's defaultAeMcpDataDir()), and each live instance
 * writes its heartbeat to `<dataRoot>/instances/<instanceId>/instance.json`.
 * A prior version of this file hardcoded a single path
 * (`instances\default\instance.json` under a literal `C:\Users\PC\...`) -
 * wrong on two counts: it assumed only one instance ID ("default") ever
 * exists, and it was missing the leading dot in ".ae-mcp" entirely.
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

const DEFAULT_INSTANCE_ID = "default";

/** Five missed polls, with a 10s floor so a very fast pollMs doesn't make the check overly twitchy. */
function computeStaleAfterMs(pollMs: number): number {
  return Math.max(pollMs * 5, 10_000);
}

interface ParsedCandidate {
  instanceDirName: string;
  filePath: string;
  data: InstanceFile;
  lastSeenAt: Date;
}

interface ValidCandidate extends ParsedCandidate {
  isLive: boolean;
}

/**
 * Reads and validates one candidate instance.json. Returns null for ANY
 * failure - missing/unreadable file, invalid JSON, schema mismatch,
 * unrecognized protocolVersion, or an unparseable lastSeen - so one
 * malformed instance directory can never block discovery of the others,
 * and never gets treated as evidence of anything (per "never fabricate").
 * Staleness (which needs `now`) is computed by the caller, not here.
 */
async function readValidCandidate(instanceDirName: string, filePath: string): Promise<ParsedCandidate | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = instanceFileSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  const data = result.data;

  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(data.protocolVersion)) {
    return null;
  }

  const lastSeenAt = new Date(data.lastSeen);
  if (Number.isNaN(lastSeenAt.getTime())) {
    return null;
  }

  return { instanceDirName, filePath, data, lastSeenAt };
}

/**
 * Lists every instance directory under `<dataDir>/instances/` and returns
 * the instance.json path each one would use - never assumes only a
 * "default" instance exists. A missing/unreadable instances root (ae-mcp
 * never run, or a wrong dataDir) simply yields no candidates - same "not
 * enough evidence, report UNKNOWN" rule as everything else here.
 */
async function discoverInstanceCandidates(dataDir: string): Promise<{ instanceDirName: string; filePath: string }[]> {
  const instancesRoot = path.join(dataDir, "instances");
  let entries;
  try {
    entries = await readdir(instancesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      instanceDirName: entry.name,
      filePath: path.join(instancesRoot, entry.name, "instance.json")
    }));
}

export interface McpInstanceFileAdapterConfig {
  /** ae-mcp's data root (the directory containing `instances/`), always resolved by env.ts - see defaultAeMcpDataDir(). */
  dataDir: string;
  /** Injectable clock for deterministic staleness tests. Defaults to the real clock. */
  now?: () => Date;
}

export class McpInstanceFileAdapter implements McpAdapter {
  private readonly dataDir: string;
  private readonly now: () => Date;

  constructor(config: McpInstanceFileAdapterConfig) {
    this.dataDir = config.dataDir;
    this.now = config.now ?? (() => new Date());
  }

  async checkHealth(): Promise<McpHealthResult> {
    const now = this.now();
    const candidates = await discoverInstanceCandidates(this.dataDir);

    const valid: ValidCandidate[] = [];
    for (const candidate of candidates) {
      const result = await readValidCandidate(candidate.instanceDirName, candidate.filePath);
      if (!result) {
        continue;
      }
      const isStale = now.getTime() - result.lastSeenAt.getTime() > computeStaleAfterMs(result.data.pollMs);
      valid.push({ ...result, isLive: result.data.listening && !isStale });
    }

    if (valid.length === 0) {
      // Never fabricated: no structurally-valid instance file was found
      // anywhere under <dataDir>/instances/ - could mean ae-mcp has never
      // run, dataDir is wrong, or every candidate found was malformed.
      // mcpConfiguredPath reports the root actually scanned, for operator
      // visibility - not a specific file, since none was usable.
      return { mcpStatus: "UNKNOWN", mcpConfiguredPath: path.join(this.dataDir, "instances") };
    }

    const liveCandidates = valid.filter((c) => c.isLive);

    // Prefer a fresh, live "default" instance first - the common case,
    // matches upstream's own default instance ID.
    const liveDefault = liveCandidates.find((c) => c.instanceDirName === DEFAULT_INSTANCE_ID);
    if (liveDefault) {
      return { mcpStatus: "ONLINE", mcpConfiguredPath: liveDefault.filePath };
    }

    // Otherwise the freshest live instance, whatever its ID.
    if (liveCandidates.length > 0) {
      const freshest = liveCandidates.reduce((a, b) => (a.lastSeenAt > b.lastSeenAt ? a : b));
      return { mcpStatus: "ONLINE", mcpConfiguredPath: freshest.filePath };
    }

    // At least one structurally-valid instance file exists, but none is
    // currently live (listening === false, or stale) - honestly OFFLINE,
    // not UNKNOWN: this IS real evidence, just evidence of "not running"
    // rather than absence of information. Reports the freshest one found.
    const freshestOffline = valid.reduce((a, b) => (a.lastSeenAt > b.lastSeenAt ? a : b));
    return { mcpStatus: "OFFLINE", mcpConfiguredPath: freshestOffline.filePath };
  }
}
