import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Exercises the REAL retry/backoff loop and rollback-decision logic in
// scripts/lib/deploy-health-check.sh by sourcing it into a real bash
// subprocess under the exact `set -Eeuo pipefail` production runs under.
// `curl` and `pm2` are replaced by fake executables on PATH for the
// duration of each test - no real PM2 process or network call is ever
// touched, per the "do not actually reload production processes during
// tests" requirement.

const currentDir = dirname(fileURLToPath(import.meta.url));
const libPath = join(currentDir, "..", "lib", "deploy-health-check.sh");

const cleanupDirs: string[] = [];

afterEach(() => {
  cleanupDirs.length = 0;
});

/** A fake `curl` that fails (exit 7, like a real connection-refused) for its
 * first `failCount` invocations across the whole test, then always succeeds -
 * simulating dyo-api/dyo-web still booting and then becoming reachable. */
function makeFakeBin(dir: string, failCount: number): void {
  mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);

  const counterFile = join(dir, "curl-call-count");
  writeFileSync(counterFile, "0");

  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
count="$(cat '${counterFile}')"
count=$((count + 1))
echo "$count" > '${counterFile}'
if [[ "$count" -le ${failCount} ]]; then
  exit 7
fi
exit 0
`
  );
  chmodSync(join(dir, "curl"), 0o755);

  writeFileSync(
    join(dir, "pm2"),
    `#!/usr/bin/env bash
if [[ "$1" == "jlist" ]]; then
  cat <<'JSON'
[{"name":"dyo-api","pm2_env":{"status":"online"}},{"name":"dyo-web","pm2_env":{"status":"online"}}]
JSON
fi
`
  );
  chmodSync(join(dir, "pm2"), 0o755);
}

function runWaitForHealthy(fakeBinDir: string, maxWaitSeconds: number, retryIntervalSeconds: number) {
  return spawnSync(
    "bash",
    ["-c", `set -Eeuo pipefail; source '${libPath}'; wait_for_healthy ${maxWaitSeconds} ${retryIntervalSeconds}`],
    {
      env: { ...process.env, PATH: `${fakeBinDir}:${process.env["PATH"]}` },
      encoding: "utf8"
    }
  );
}

function runDescribeRollbackDecision(previousSha: string, expectedSha: string, schemaChanged: 0 | 1) {
  return spawnSync(
    "bash",
    ["-c", `set -Eeuo pipefail; source '${libPath}'; describe_rollback_decision '${previousSha}' '${expectedSha}' ${schemaChanged}`],
    { encoding: "utf8" }
  );
}

describe("wait_for_healthy", () => {
  it("recovers from an initial connection-refused and reports success once the app comes up", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "deploy-health-check-"));
    // Two failures (the first iteration's live+web checks), then success.
    makeFakeBin(fakeBinDir, 2);

    const result = runWaitForHealthy(fakeBinDir, 6, 1);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Waiting for dyo-api readiness...");
    expect(result.stdout).toContain("attempt 1/6");
    expect(result.stdout).toContain("dyo-api ready");
    expect(result.stdout).toContain("dyo-web ready");
    expect(result.stdout).toContain("deployment healthy");
  });

  it("fails closed after the full timeout when the app never becomes reachable", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "deploy-health-check-"));
    // Always fail - simulates a genuinely broken deployment, not a boot race.
    makeFakeBin(fakeBinDir, 999);

    const result = runWaitForHealthy(fakeBinDir, 3, 1);

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("deployment healthy");
    expect(result.stderr).toContain("Health check timed out after 3s");
    expect(result.stderr).toContain("dyo-api ready: no");
    expect(result.stderr).toContain("dyo-web ready: no");
  });

  it("never prints a raw curl error on a retried attempt", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "deploy-health-check-"));
    makeFakeBin(fakeBinDir, 2);

    const result = runWaitForHealthy(fakeBinDir, 6, 1);

    expect(result.stdout).not.toMatch(/curl:/i);
    expect(result.stderr).not.toMatch(/curl:/i);
  });
});

describe("describe_rollback_decision", () => {
  it("refuses rollback when this deployment changed the schema, regardless of SHA", () => {
    const differentShas = runDescribeRollbackDecision("aaa", "bbb", 1);
    expect(differentShas.stdout.trim()).toBe("SCHEMA_CHANGED_STOP");

    const sameSha = runDescribeRollbackDecision("aaa", "aaa", 1);
    expect(sameSha.stdout.trim()).toBe("SCHEMA_CHANGED_STOP");
  });

  it("suppresses a pointless same-SHA rollback when the schema did not change", () => {
    const result = runDescribeRollbackDecision("cd332221d71c1808d7dbcd2876073e1ea6f949c9", "cd332221d71c1808d7dbcd2876073e1ea6f949c9", 0);
    expect(result.stdout.trim()).toBe("SAME_SHA_STOP");
  });

  it("allows a real code-only rollback when the SHA differs and the schema did not change", () => {
    const result = runDescribeRollbackDecision("aaa", "bbb", 0);
    expect(result.stdout.trim()).toBe("ATTEMPT_ROLLBACK");
  });
});

describe("scripts/deploy-production.sh wiring", () => {
  it("sources the shared health-check library and never redefines its own inline health check", () => {
    const scriptPath = join(currentDir, "..", "deploy-production.sh");
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("source \"$APP_DIR/scripts/lib/deploy-health-check.sh\"");
    expect(script).toContain("wait_for_healthy \"$HEALTH_MAX_WAIT_SECONDS\" \"$HEALTH_RETRY_INTERVAL_SECONDS\"");
    expect(script).toContain("describe_rollback_decision \"$PREVIOUS_SHA\" \"$EXPECTED_SHA\" \"$SCHEMA_CHANGED\"");
    expect(script).not.toContain("health_check_passed()");
  });
});
