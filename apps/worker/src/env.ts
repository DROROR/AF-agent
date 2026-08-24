import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ConfigError } from "./errors/worker-error.js";

/**
 * Windows default per docs/engineering/SECURITY.md ("restrict job files to a
 * configured work root such as C:\DYO-Agent\"). Overridable via WORK_ROOT,
 * primarily so this can run in non-Windows dev/test environments too.
 */
const DEFAULT_WORK_ROOT_WINDOWS = "C:\\DYO-Agent";

const rawEnvSchema = z.object({
  DYO_API_URL: z.string().trim().url("DYO_API_URL must be a valid URL"),
  WORKER_NAME: z.string().trim().min(1).max(200),
  WORKER_ID: z.string().trim().uuid().optional(),
  WORKER_TOKEN: z.string().trim().min(1).optional(),
  /**
   * Used only for one-time pairing when WORKER_ID/WORKER_TOKEN are not yet
   * known (see docs/WINDOWS-WORKER.md "Pairing/registration"). Never logged.
   */
  WORKER_REGISTRATION_SECRET: z.string().trim().min(16).optional(),
  WORK_ROOT: z.string().trim().min(1).optional(),
  AE_PATH: z.string().trim().min(1).optional(),
  AERENDER_PATH: z.string().trim().min(1).optional(),
  AE_MCP_PATH: z.string().trim().min(1).optional(),
  /**
   * ae-mcp's data root - confirmed against the real upstream
   * HeroicSwan/after-effects-mcp implementation, which always uses
   * `os.homedir() + ".ae-mcp"` (never derived from AE_MCP_PATH, the
   * separate install directory). Optional override; when unset, resolved
   * the same way upstream ae-mcp itself resolves it - see
   * defaultAeMcpDataDir() below. McpInstanceFileAdapter scans
   * `<dataDir>/instances/*\/instance.json` under this root against a
   * schema confirmed from a real client sample (see
   * mcp-instance-file-adapter.ts) - ONLINE/OFFLINE/UNKNOWN, never
   * fabricated from an unrecognized shape or protocol version.
   */
  AE_MCP_DATA_DIR: z.string().trim().min(1).optional(),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15_000)
});

export interface WorkerEnv {
  apiUrl: string;
  workerName: string;
  workerId: string | undefined;
  workerToken: string | undefined;
  workerRegistrationSecret: string | undefined;
  workRoot: string;
  aePath: string | undefined;
  aerenderPath: string | undefined;
  aeMcpPath: string | undefined;
  aeMcpDataDir: string;
  heartbeatIntervalMs: number;
}

function defaultWorkRoot(): string {
  return process.platform === "win32"
    ? DEFAULT_WORK_ROOT_WINDOWS
    : path.join(os.tmpdir(), "dyo-agent");
}

/** Matches the real upstream HeroicSwan/after-effects-mcp convention exactly: `os.homedir() + ".ae-mcp"`. */
function defaultAeMcpDataDir(): string {
  return path.join(os.homedir(), ".ae-mcp");
}

/** Environment variables are an external boundary - validated with Zod like any other input. */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = rawEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(`Invalid worker environment: ${parsed.error.message}`);
  }
  const data = parsed.data;

  const hasPreProvisionedCredentials = Boolean(data.WORKER_ID) || Boolean(data.WORKER_TOKEN);
  if (hasPreProvisionedCredentials && !(data.WORKER_ID && data.WORKER_TOKEN)) {
    throw new ConfigError(
      "WORKER_ID and WORKER_TOKEN must both be set, or both left unset for first-time pairing"
    );
  }

  return {
    apiUrl: data.DYO_API_URL.replace(/\/+$/, ""),
    workerName: data.WORKER_NAME,
    workerId: data.WORKER_ID,
    workerToken: data.WORKER_TOKEN,
    workerRegistrationSecret: data.WORKER_REGISTRATION_SECRET,
    workRoot: data.WORK_ROOT ?? defaultWorkRoot(),
    aePath: data.AE_PATH,
    aerenderPath: data.AERENDER_PATH,
    aeMcpPath: data.AE_MCP_PATH,
    aeMcpDataDir: data.AE_MCP_DATA_DIR ?? defaultAeMcpDataDir(),
    heartbeatIntervalMs: data.HEARTBEAT_INTERVAL_MS
  };
}
