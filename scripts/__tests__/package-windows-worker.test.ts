import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(currentDir, "..", "..");
const scriptPath = join(currentDir, "..", "package-windows-worker.mjs");
const scriptSource = readFileSync(scriptPath, "utf8");
const workerAppDir = join(REPO_ROOT, "deploy", "windows-worker", "worker-app");

/**
 * Real packaging-reproducibility gap (found 2026-09-02, P2 follow-up to
 * the MCP investigation): worker-app/package.json declares semver RANGES
 * for its runtime dependencies, and until this fix nothing shipped a lock
 * file alongside it - the client's own `npm install --omit=dev` (Step 3
 * of DYO-Worker-Setup.ps1/DYO-Worker-Final-Update.ps1) was free to
 * resolve whatever versions satisfy those ranges at whatever moment the
 * client happened to run it, silently drifting from whatever this build
 * was actually tested against.
 */
describe("package-windows-worker.mjs generates a real lock file, closing the reproducibility gap (structural checks on the script source, no execution)", () => {
  it("runs 'npm install --package-lock-only' inside WORKER_APP_DIR AFTER worker-app/package.json is written", () => {
    const pkgJsonWriteIdx = scriptSource.indexOf('writeJson(path.join(WORKER_APP_DIR, "package.json")');
    const lockCallIdx = scriptSource.indexOf('run("npm", ["install", "--package-lock-only"');
    expect(pkgJsonWriteIdx).toBeGreaterThan(-1);
    expect(lockCallIdx).toBeGreaterThan(pkgJsonWriteIdx);
  });

  it("the lock-file generation call is scoped to WORKER_APP_DIR (never the monorepo root), so it can never touch the real root package-lock.json", () => {
    const lockCallIdx = scriptSource.indexOf('run("npm", ["install", "--package-lock-only"');
    expect(lockCallIdx).toBeGreaterThan(-1);
    const line = scriptSource.slice(lockCallIdx, scriptSource.indexOf("\n", lockCallIdx));
    expect(line).toContain("WORKER_APP_DIR");
  });

  it("passes --no-audit --no-fund, matching the exact flags the client's own later npm install --omit=dev already uses (DYO-Worker-Final-Update.ps1 Step 3) - consistent, quiet output, no extra network calls beyond dependency resolution itself", () => {
    const lockCallIdx = scriptSource.indexOf('run("npm", ["install", "--package-lock-only"');
    const line = scriptSource.slice(lockCallIdx, scriptSource.indexOf("\n", lockCallIdx));
    expect(line).toContain("--no-audit");
    expect(line).toContain("--no-fund");
  });

  it("never hardcodes or bumps a runtime dependency version anywhere in this script - the ranges in apps/worker/package.json remain the single source of truth, this only pins whatever they already resolve to", () => {
    // No version-looking string literal (e.g. "1.30.0") assigned to a
    // dependency field anywhere in the script - the only version-shaped
    // strings that may legitimately appear are `workerSrcPkg.version`/
    // `schemasSrcPkg.version` (read FROM the real package.json files, not
    // literals) and the package's own declared "0.1.0" version passthrough.
    const dependencyBlockMatches = scriptSource.match(/dependencies:\s*\{[^}]*\}/gs) ?? [];
    for (const block of dependencyBlockMatches) {
      expect(block).not.toMatch(/:\s*"\d+\.\d+\.\d+"/);
    }
  });
});

/**
 * Real, end-to-end integration check (not mocked) - actually runs the
 * packaging script and inspects the artifact it produces. Slower (~10-20s:
 * two real tsc builds plus one real npm dependency resolution) and needs
 * real network access to the npm registry (same requirement the client's
 * own npm install --omit=dev already has) - this is deliberate: a
 * structural-only check on the script's source text would not have caught
 * the original bug (a MISSING file this script never wrote at all), only
 * actually running it and checking what landed on disk does.
 */
describe("package-windows-worker.mjs end-to-end: the packaged artifact resolves the exact intended versions", () => {
  it("running the real script produces a worker-app/package-lock.json that pins EXACT versions for every runtime dependency declared in worker-app/package.json, and a subsequent npm install --omit=dev installs exactly those pinned versions", () => {
    execFileSync("node", [scriptPath], { cwd: REPO_ROOT, stdio: "pipe" });

    const packageJsonPath = join(workerAppDir, "package.json");
    const lockPath = join(workerAppDir, "package-lock.json");
    expect(existsSync(packageJsonPath)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { dependencies: Record<string, string> };
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { lockfileVersion: number; packages: Record<string, { version?: string; resolved?: string; link?: boolean }> };

    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(2);

    for (const [depName, range] of Object.entries(packageJson.dependencies)) {
      const entry = lock.packages[`node_modules/${depName}`];
      expect(entry, `${depName} missing from the generated lock file`).toBeTruthy();
      if (range.startsWith("file:")) {
        // @dyo/schemas - a local link, not a registry-resolved version.
        expect(entry!.link).toBe(true);
      } else {
        expect(entry!.version, `${depName} has no pinned version in the lock file`).toBeTruthy();
      }
    }

    // Real client-side install, using the freshly-generated lock file,
    // must install exactly the pinned versions - the actual guarantee
    // this whole fix exists to provide, verified end to end rather than
    // just asserting the lock file's own internal shape looks right.
    execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: workerAppDir, stdio: "pipe" });
    for (const [depName, range] of Object.entries(packageJson.dependencies)) {
      if (range.startsWith("file:")) continue;
      const installedPkg = JSON.parse(readFileSync(join(workerAppDir, "node_modules", depName, "package.json"), "utf8")) as { version: string };
      const lockedVersion = lock.packages[`node_modules/${depName}`]!.version;
      expect(installedPkg.version).toBe(lockedVersion);
    }
  }, 120_000);
});
