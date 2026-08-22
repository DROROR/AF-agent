import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const CREDENTIALS_FILE_NAME = "worker-credentials.json";

const storedCredentialsSchema = z.object({
  workerId: z.string().uuid(),
  workerToken: z.string().min(1)
});

export interface WorkerCredentials {
  workerId: string;
  workerToken: string;
}

/**
 * At-rest protection caveat for `worker-credentials.json`. The `mode: 0o600`
 * option below gives real owner-only protection on POSIX systems
 * (Linux/macOS, including this repo's dev/test environment). Node.js does
 * not implement POSIX permission bits on Windows - the worker's actual
 * runtime target - so on Windows this option has no meaningful effect; real
 * protection there depends entirely on NTFS ACLs inherited from WORK_ROOT
 * and its parent directories. This code neither sets nor verifies those
 * ACLs, and cannot: there is no Windows machine in this development
 * environment to validate against. Do not treat this file as protected on
 * Windows until that ACL behavior has been checked on the real Windows
 * worker (see docs/WINDOWS-WORKER.md "Credential file protection").
 */
export const CREDENTIAL_FILE_PROTECTION_CAVEAT =
  "worker-credentials.json: mode 0o600 enforces owner-only access on POSIX only; " +
  "Windows at-rest protection depends on NTFS ACLs and is not verified by this code - " +
  "confirm on the real Windows worker before relying on it.";

/**
 * Persists the credentials issued by one-time pairing so subsequent restarts
 * do not need WORKER_REGISTRATION_SECRET again. Lives under WORK_ROOT/state,
 * never inside a job workspace. Content is never logged (docs/engineering/
 * SECURITY.md, OBSERVABILITY.md "never log secrets") - see
 * CREDENTIAL_FILE_PROTECTION_CAVEAT above for what file mode does and does
 * not protect against on Windows.
 */
export class CredentialStore {
  private readonly filePath: string;

  constructor(workRoot: string) {
    this.filePath = path.join(workRoot, "state", CREDENTIALS_FILE_NAME);
  }

  load(): WorkerCredentials | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    const raw = readFileSync(this.filePath, "utf8");
    const parsed = storedCredentialsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  }

  save(credentials: WorkerCredentials): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    // mode 0o600 is a real owner-only restriction on POSIX; on Windows it is
    // not - see CREDENTIAL_FILE_PROTECTION_CAVEAT above.
    writeFileSync(this.filePath, JSON.stringify(credentials, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
  }
}
