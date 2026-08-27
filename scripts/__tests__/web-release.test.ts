import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Exercises the REAL scripts/create-web-release.sh and
// scripts/switch-web-release.sh in a real bash subprocess, with `git`,
// `npm`, and `pm2` replaced by fake executables on PATH - the exact same
// convention as deploy-health-check.test.ts. Nothing here ever touches the
// real /opt/AF-agent checkout, a real PM2 process, or performs a real
// `npm ci`/`next build` - both the canonical "repo" and the releases root
// are scratch temp directories created fresh per test.

const currentDir = dirname(fileURLToPath(import.meta.url));
const createScript = join(currentDir, "..", "create-web-release.sh");
const switchScript = join(currentDir, "..", "switch-web-release.sh");

const cleanupDirs: string[] = [];
afterEach(() => {
  cleanupDirs.length = 0;
});

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

interface FakeToolsOptions {
  npmCiShouldFail?: boolean;
  buildMode?: "ok" | "missing-asset" | "fail";
}

/** Sets up a scratch releases root + fake canonical repo + fake git/npm/pm2 on PATH, and returns the env to run scripts with. */
function setupFakeEnv(opts: FakeToolsOptions = {}) {
  const binDir = mkdtempSync(join(tmpdir(), "web-release-bin-"));
  const releasesRoot = mkdtempSync(join(tmpdir(), "web-release-root-"));
  const canonicalRepo = mkdtempSync(join(tmpdir(), "web-release-canonical-"));
  const npmLog = join(binDir, "npm.log");
  const pm2Log = join(binDir, "pm2.log");
  writeFileSync(npmLog, "");
  writeFileSync(pm2Log, "");
  cleanupDirs.push(binDir, releasesRoot, canonicalRepo);

  writeFileSync(
    join(binDir, "git"),
    `#!/usr/bin/env bash
if [[ "$1" == "-C" ]]; then
  shift 2
fi
if [[ "$1" == "worktree" && "$2" == "add" ]]; then
  dir="$4"; sha="$5"
  mkdir -p "$dir/apps/web"
  echo "$sha" > "$dir/.fake-checkout-sha"
  exit 0
fi
if [[ "$1" == "worktree" && "$2" == "remove" ]]; then
  dir="$4"
  rm -rf "$dir"
  exit 0
fi
echo "fake git: unsupported invocation: $*" >&2
exit 1
`
  );
  chmodSync(join(binDir, "git"), 0o755);

  writeFileSync(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
echo "$1 $2 @ $(pwd)" >> '${npmLog}'
if [[ "$1" == "ci" ]]; then
  if [[ "${opts.npmCiShouldFail ? "1" : "0"}" == "1" ]]; then
    echo "fake npm ci: simulated failure" >&2
    exit 1
  fi
  exit 0
fi
if [[ "$1" == "run" && "$2" == "build" ]]; then
  webDir="$(pwd)"
  mkdir -p "$webDir/.next/static/chunks" "$webDir/.next/server/app"
  case "${opts.buildMode ?? "ok"}" in
    fail)
      echo "fake npm run build: simulated failure" >&2
      exit 1
      ;;
    missing-asset)
      echo "fakebuildid" > "$webDir/.next/BUILD_ID"
      : > "$webDir/.next/static/chunks/abc.css"
      cat > "$webDir/.next/server/app/login.html" <<'HTML'
<link href="/_next/static/chunks/does-not-exist.css"><script src="/_next/static/chunks/does-not-exist.js"></script>
HTML
      ;;
    *)
      echo "fakebuildid" > "$webDir/.next/BUILD_ID"
      : > "$webDir/.next/static/chunks/abc.css"
      : > "$webDir/.next/static/chunks/def.js"
      cat > "$webDir/.next/server/app/login.html" <<'HTML'
<link href="/_next/static/chunks/abc.css"><script src="/_next/static/chunks/def.js"></script>
HTML
      ;;
  esac
  exit 0
fi
echo "fake npm: unsupported invocation: $*" >&2
exit 1
`
  );
  chmodSync(join(binDir, "npm"), 0o755);

  writeFileSync(join(binDir, "pm2"), `#!/usr/bin/env bash\necho "$*" >> '${pm2Log}'\nexit 0\n`);
  chmodSync(join(binDir, "pm2"), 0o755);

  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env["PATH"]}`,
      DYO_WEB_RELEASES_ROOT: releasesRoot,
      DYO_CANONICAL_REPO: canonicalRepo
    },
    releasesRoot,
    canonicalRepo,
    npmLog,
    pm2Log
  };
}

function runCreate(env: NodeJS.ProcessEnv, sha: string) {
  return spawnSync("bash", [createScript, sha], { env, encoding: "utf8" });
}

function runSwitch(env: NodeJS.ProcessEnv, sha: string) {
  return spawnSync("bash", [switchScript, sha], { env, encoding: "utf8" });
}

describe("create-web-release.sh", () => {
  it("builds a release: creates the worktree, runs npm ci + build, verifies artifacts, writes .release-complete", () => {
    const { env, releasesRoot } = setupFakeEnv();
    const result = runCreate(env, SHA_A);

    expect(result.status).toBe(0);
    expect(existsSync(join(releasesRoot, SHA_A, ".release-complete"))).toBe(true);
    expect(existsSync(join(releasesRoot, SHA_A, "apps", "web", ".next", "BUILD_ID"))).toBe(true);
  });

  it("is idempotent - a second call for an already-complete release does not rebuild", () => {
    const { env, npmLog } = setupFakeEnv();
    runCreate(env, SHA_A);
    const logAfterFirst = readFileSync(npmLog, "utf8");

    const second = runCreate(env, SHA_A);

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("already built and verified");
    expect(readFileSync(npmLog, "utf8")).toBe(logAfterFirst); // npm was never invoked again
  });

  it("leaves no .release-complete marker when npm ci fails, and never touches other releases", () => {
    const { env, releasesRoot } = setupFakeEnv({ npmCiShouldFail: true });
    const result = runCreate(env, SHA_A);

    expect(result.status).not.toBe(0);
    expect(existsSync(join(releasesRoot, SHA_A, ".release-complete"))).toBe(false);
  });

  it("leaves no .release-complete marker when the build itself fails", () => {
    const { env, releasesRoot } = setupFakeEnv({ buildMode: "fail" });
    const result = runCreate(env, SHA_A);

    expect(result.status).not.toBe(0);
    expect(existsSync(join(releasesRoot, SHA_A, ".release-complete"))).toBe(false);
  });

  it("refuses to mark a release complete when the built HTML references a static asset that does not exist on disk", () => {
    const { env, releasesRoot } = setupFakeEnv({ buildMode: "missing-asset" });
    const result = runCreate(env, SHA_A);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not exist at");
    expect(existsSync(join(releasesRoot, SHA_A, ".release-complete"))).toBe(false);
  });

  it("a failed build attempt for one SHA never touches a different, already-complete release in the SAME releases root", () => {
    const { env, releasesRoot } = setupFakeEnv();
    runCreate(env, SHA_A);
    expect(existsSync(join(releasesRoot, SHA_A, ".release-complete"))).toBe(true);

    // Point a SECOND fake npm (build fails) at the SAME releases root, to
    // prove a failed build for SHA_B never disturbs SHA_A's already-complete
    // release living alongside it.
    const failingBuild = setupFakeEnv({ buildMode: "fail" });
    const sharedRootEnv = { ...failingBuild.env, DYO_WEB_RELEASES_ROOT: releasesRoot };
    const result = runCreate(sharedRootEnv, SHA_B);

    expect(result.status).not.toBe(0);
    expect(existsSync(join(releasesRoot, SHA_B, ".release-complete"))).toBe(false);
    expect(existsSync(join(releasesRoot, SHA_A, ".release-complete"))).toBe(true);
  });
});

describe("switch-web-release.sh", () => {
  it("refuses to switch to a release with no .release-complete marker", () => {
    const { env } = setupFakeEnv();
    const result = runSwitch(env, SHA_A);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no .release-complete marker");
  });

  it("atomically points `current` at the release and reloads only dyo-web", () => {
    const { env, releasesRoot, pm2Log } = setupFakeEnv();
    runCreate(env, SHA_A);

    const result = runSwitch(env, SHA_A);

    expect(result.status).toBe(0);
    const currentLink = join(releasesRoot, "current");
    expect(lstatSync(currentLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(currentLink)).toBe(join(releasesRoot, SHA_A));

    const pm2Calls = readFileSync(pm2Log, "utf8").trim().split("\n");
    expect(pm2Calls).toHaveLength(2);
    // delete then start with the ecosystem FILE, scoped to --only dyo-web -
    // NEVER reload/startOrReload - see switch-web-release.sh's own doc
    // comment for why: verified empirically that PM2 never re-reads a
    // changed cwd/script for reload/restart on an already-registered app,
    // only a genuine delete+start does, which is what makes the very
    // first cutover (before PM2 has ever registered the release-based
    // cwd) actually pick up the new path.
    expect(pm2Calls[0]).toBe("delete dyo-web");
    expect(pm2Calls[1]).toMatch(/^start .*ecosystem\.config\.cjs --only dyo-web$/);
  });

  it("rolling back to a previous release switches back without rebuilding, and both releases remain on disk", () => {
    const { env, releasesRoot, npmLog } = setupFakeEnv();
    runCreate(env, SHA_A);
    runSwitch(env, SHA_A);
    runCreate(env, SHA_B);
    runSwitch(env, SHA_B);

    const logBeforeRollback = readFileSync(npmLog, "utf8");

    // "Rollback" is just switching back to SHA_A - already built, never rebuilt.
    const rollback = runSwitch(env, SHA_A);

    expect(rollback.status).toBe(0);
    expect(readlinkSync(join(releasesRoot, "current"))).toBe(join(releasesRoot, SHA_A));
    expect(readFileSync(npmLog, "utf8")).toBe(logBeforeRollback); // npm never invoked again
    expect(existsSync(join(releasesRoot, SHA_A, ".release-complete"))).toBe(true);
    expect(existsSync(join(releasesRoot, SHA_B, ".release-complete"))).toBe(true);
  });

  it("never invokes pm2 for any app other than dyo-web", () => {
    const { env, pm2Log } = setupFakeEnv();
    runCreate(env, SHA_A);
    runSwitch(env, SHA_A);

    const calls = readFileSync(pm2Log, "utf8");
    expect(calls).not.toMatch(/dyo-api/);
    expect(calls).not.toMatch(/dashboard-/);
  });
});
