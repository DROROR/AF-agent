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
[{"name":"dyo-api","pid":500,"pm2_env":{"status":"online"}},{"name":"dyo-web","pid":999,"pm2_env":{"status":"online"}}]
JSON
fi
`
  );
  chmodSync(join(dir, "pm2"), 0o755);

  // A healthy deploy: the real port-4000 listener IS pm2's own reported
  // dyo-api pid (500) - see the port-ownership describe blocks further
  // down for the cases where it deliberately is NOT.
  writeFileSync(join(dir, "ss"), `#!/usr/bin/env bash\necho 'LISTEN 0 511 127.0.0.1:4000 0.0.0.0:*    users:(("node",pid=500,fd=25))'\n`);
  chmodSync(join(dir, "ss"), 0o755);
  writeFileSync(join(dir, "ps"), "#!/usr/bin/env bash\necho ' 1'\n");
  chmodSync(join(dir, "ps"), 0o755);
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

  it("checks port ownership BEFORE doing anything else - never kills the unexpected owner", () => {
    const scriptPath = join(currentDir, "..", "deploy-production.sh");
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("verify_no_unexpected_port_owner 4000 dyo-api");
    const lockIndex = script.indexOf("flock -n 9");
    const portCheckIndex = script.indexOf("verify_no_unexpected_port_owner");
    const npmCiIndex = script.indexOf("npm ci");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(portCheckIndex).toBeGreaterThan(lockIndex);
    expect(portCheckIndex).toBeLessThan(npmCiIndex);
    // Fails safely; never runs kill/pkill against whatever it finds.
    expect(script).not.toMatch(/\bkill\b.*unexpected/i);
    expect(script).not.toContain("pkill");
  });
});

/**
 * 2026-08-26 incident regression coverage: a manually-launched,
 * PM2-unmanaged process occupied port 4000 while the real PM2-managed
 * dyo-api crash-looped on EADDRINUSE in the background. `curl`/`pm2`/`ss`/
 * `ps` are all faked so these tests never touch a real port, process, or
 * PM2 instance.
 */
function makePortOwnershipFakeBin(
  dir: string,
  opts: { pm2Pid?: string; listenerPid?: string; listenerPpid?: string }
): void {
  mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);

  writeFileSync(join(dir, "curl"), "#!/usr/bin/env bash\nexit 7\n");
  chmodSync(join(dir, "curl"), 0o755);

  const pm2ApiEntry =
    opts.pm2Pid !== undefined
      ? `{"name":"dyo-api","pid":${opts.pm2Pid},"pm2_env":{"status":"online"}}`
      : `{"name":"dyo-api","pm2_env":{"status":"errored"}}`;
  writeFileSync(
    join(dir, "pm2"),
    `#!/usr/bin/env bash
if [[ "$1" == "jlist" ]]; then
  cat <<JSON
[${pm2ApiEntry},{"name":"dyo-web","pid":999,"pm2_env":{"status":"online"}}]
JSON
fi
`
  );
  chmodSync(join(dir, "pm2"), 0o755);

  const ssLine =
    opts.listenerPid !== undefined
      ? `LISTEN 0 511 127.0.0.1:4000 0.0.0.0:*    users:(("node",pid=${opts.listenerPid},fd=25))`
      : "";
  writeFileSync(join(dir, "ss"), `#!/usr/bin/env bash\necho '${ssLine}'\n`);
  chmodSync(join(dir, "ss"), 0o755);

  writeFileSync(join(dir, "ps"), `#!/usr/bin/env bash\necho ' ${opts.listenerPpid ?? "1"}'\n`);
  chmodSync(join(dir, "ps"), 0o755);
}

function runShellFn(fakeBinDir: string, expression: string) {
  return spawnSync("bash", ["-c", `set -Eeuo pipefail; source '${libPath}'; ${expression}`], {
    env: { ...process.env, PATH: `${fakeBinDir}:${process.env["PATH"]}` },
    encoding: "utf8"
  });
}

describe("get_port_listener_pid / get_pm2_managed_pid / port_owned_by_pid_or_child", () => {
  it("extracts the real listener pid from ss output", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { listenerPid: "4242" });
    const result = runShellFn(dir, "get_port_listener_pid 4000");
    expect(result.stdout.trim()).toBe("4242");
  });

  it("returns empty when nothing is listening", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, {});
    const result = runShellFn(dir, "get_port_listener_pid 4000");
    expect(result.stdout.trim()).toBe("");
  });

  it("extracts the pm2-reported pid for the named online app", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { pm2Pid: "555" });
    const result = runShellFn(dir, "get_pm2_managed_pid dyo-api");
    expect(result.stdout.trim()).toBe("555");
  });

  it("returns empty when pm2 does not report the app online (e.g. it is crash-looping)", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, {});
    const result = runShellFn(dir, "get_pm2_managed_pid dyo-api");
    expect(result.stdout.trim()).toBe("");
  });

  it("matches when the listener pid equals the expected pid exactly", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, {});
    const result = runShellFn(dir, "port_owned_by_pid_or_child 100 100 && echo MATCH || echo NO_MATCH");
    expect(result.stdout.trim()).toBe("MATCH");
  });

  it("matches when the listener pid is a direct child of the expected pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { listenerPpid: "100" });
    const result = runShellFn(dir, "port_owned_by_pid_or_child 200 100 && echo MATCH || echo NO_MATCH");
    expect(result.stdout.trim()).toBe("MATCH");
  });

  it("never matches an unrelated pid, even if both are alive", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { listenerPpid: "1" });
    const result = runShellFn(dir, "port_owned_by_pid_or_child 200 100 && echo MATCH || echo NO_MATCH");
    expect(result.stdout.trim()).toBe("NO_MATCH");
  });
});

describe("verify_no_unexpected_port_owner (pre-deploy gate)", () => {
  it("passes when the port is free", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, {});
    const result = runShellFn(dir, "verify_no_unexpected_port_owner 4000 dyo-api");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("free");
  });

  it("passes when the port is already owned by dyo-api's own current PM2 pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { pm2Pid: "300", listenerPid: "300" });
    const result = runShellFn(dir, "verify_no_unexpected_port_owner 4000 dyo-api");
    expect(result.status).toBe(0);
  });

  it("fails closed - and reports the real pid - when an unexpected process owns the port", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    // The exact incident shape: something is listening (an orphaned manual
    // process), but PM2 has no online dyo-api at all (it's crash-looping).
    makePortOwnershipFakeBin(dir, { listenerPid: "9999" });
    const result = runShellFn(dir, "verify_no_unexpected_port_owner 4000 dyo-api");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("9999");
    expect(result.stderr).toContain("NOT killed");
  });

  it("never invokes kill/pkill against the unexpected process", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { listenerPid: "9999" });
    // A fake `kill`/`pkill` that would fail the test outright if invoked.
    writeFileSync(join(dir, "kill"), "#!/usr/bin/env bash\necho SHOULD_NEVER_RUN >&2\nexit 1\n");
    chmodSync(join(dir, "kill"), 0o755);
    writeFileSync(join(dir, "pkill"), "#!/usr/bin/env bash\necho SHOULD_NEVER_RUN >&2\nexit 1\n");
    chmodSync(join(dir, "pkill"), 0o755);

    const result = runShellFn(dir, "verify_no_unexpected_port_owner 4000 dyo-api");
    expect(result.stderr).not.toContain("SHOULD_NEVER_RUN");
  });
});

describe("verify_port_owned_by_pm2 (post-reload gate)", () => {
  it("passes when the real port listener is exactly PM2's reported pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { pm2Pid: "500", listenerPid: "500" });
    const result = runShellFn(dir, "verify_port_owned_by_pm2 4000 dyo-api && echo PASS || echo FAIL");
    expect(result.stdout.trim()).toBe("PASS");
  });

  it("passes when the real port listener is a direct child of PM2's reported pid (tsx wrapper case)", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { pm2Pid: "500", listenerPid: "501", listenerPpid: "500" });
    const result = runShellFn(dir, "verify_port_owned_by_pm2 4000 dyo-api && echo PASS || echo FAIL");
    expect(result.stdout.trim()).toBe("PASS");
  });

  it("FAILS the exact 2026-08-26 incident shape: pm2 reports dyo-api online, but an unrelated pid actually owns the port", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    // PM2 believes dyo-api is pid 500 (its own crash-looping child never
    // successfully bound the port), while an orphaned manual process
    // (pid 9999) is what's actually listening and answering health checks.
    makePortOwnershipFakeBin(dir, { pm2Pid: "500", listenerPid: "9999", listenerPpid: "1" });
    const result = runShellFn(dir, "verify_port_owned_by_pm2 4000 dyo-api && echo PASS || echo FAIL");
    expect(result.stdout.trim()).toBe("FAIL");
  });

  it("fails when pm2 does not report dyo-api online at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { listenerPid: "9999" });
    const result = runShellFn(dir, "verify_port_owned_by_pm2 4000 dyo-api && echo PASS || echo FAIL");
    expect(result.stdout.trim()).toBe("FAIL");
  });

  it("fails when nothing is listening on the port yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    makePortOwnershipFakeBin(dir, { pm2Pid: "500" });
    const result = runShellFn(dir, "verify_port_owned_by_pm2 4000 dyo-api && echo PASS || echo FAIL");
    expect(result.stdout.trim()).toBe("FAIL");
  });
});

describe("wait_for_healthy - end to end with port ownership required", () => {
  it("never declares success when curl/pm2 both look healthy but the port is owned by the wrong pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    // curl always succeeds and pm2 reports both apps online - the OLD
    // (pre-hardening) success condition - but the real port-4000 listener
    // (9999) does not match PM2's reported dyo-api pid (500) at all.
    writeFileSync(join(dir, "curl"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(join(dir, "curl"), 0o755);
    writeFileSync(
      join(dir, "pm2"),
      `#!/usr/bin/env bash
if [[ "$1" == "jlist" ]]; then
  cat <<'JSON'
[{"name":"dyo-api","pid":500,"pm2_env":{"status":"online"}},{"name":"dyo-web","pid":999,"pm2_env":{"status":"online"}}]
JSON
fi
`
    );
    chmodSync(join(dir, "pm2"), 0o755);
    writeFileSync(join(dir, "ss"), `#!/usr/bin/env bash\necho 'LISTEN 0 511 127.0.0.1:4000 0.0.0.0:*    users:(("node",pid=9999,fd=25))'\n`);
    chmodSync(join(dir, "ss"), 0o755);
    writeFileSync(join(dir, "ps"), "#!/usr/bin/env bash\necho ' 1'\n");
    chmodSync(join(dir, "ps"), 0o755);

    const result = runWaitForHealthy(dir, 2, 1);

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("deployment healthy");
    expect(result.stderr).toContain("port 4000 ownership: NOT verified");
  });

  it("declares success once the port listener genuinely matches the PM2-managed pid", () => {
    const dir = mkdtempSync(join(tmpdir(), "port-ownership-"));
    writeFileSync(join(dir, "curl"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(join(dir, "curl"), 0o755);
    writeFileSync(
      join(dir, "pm2"),
      `#!/usr/bin/env bash
if [[ "$1" == "jlist" ]]; then
  cat <<'JSON'
[{"name":"dyo-api","pid":500,"pm2_env":{"status":"online"}},{"name":"dyo-web","pid":999,"pm2_env":{"status":"online"}}]
JSON
fi
`
    );
    chmodSync(join(dir, "pm2"), 0o755);
    writeFileSync(join(dir, "ss"), `#!/usr/bin/env bash\necho 'LISTEN 0 511 127.0.0.1:4000 0.0.0.0:*    users:(("node",pid=500,fd=25))'\n`);
    chmodSync(join(dir, "ss"), 0o755);
    writeFileSync(join(dir, "ps"), "#!/usr/bin/env bash\necho ' 1'\n");
    chmodSync(join(dir, "ps"), 0o755);

    const result = runWaitForHealthy(dir, 4, 1);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deployment healthy");
  });
});
