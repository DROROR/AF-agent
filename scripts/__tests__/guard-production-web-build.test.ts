import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Executable regression coverage (spawns real Node, never a direct TS
// import of the plain-JS script - same convention as
// scripts/windows-worker/__tests__/validate-env.test.ts) for the
// 2026-08-27 incident: `npm run build` run directly in the live production
// checkout overwrote the exact static assets the already-running dyo-web
// process was serving. This guard is what apps/web's `prebuild` now runs
// first - see the guard script's own module doc comment.

const currentDir = dirname(fileURLToPath(import.meta.url));
const realGuardScript = join(currentDir, "..", "guard-production-web-build.mjs");

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Copies the real guard script into a fresh fixture "repo root" at
 * <fixture>/scripts/guard-production-web-build.mjs - the script computes
 * its own repo root as one directory above itself, so running THIS copy
 * makes it treat <fixture> as the checkout being guarded, without ever
 * touching the real repo.
 */
function makeFixtureRepo(withMarker: boolean): string {
  const fixture = mkdtempSync(join(tmpdir(), "guard-fixture-"));
  cleanupDirs.push(fixture);
  mkdirSync(join(fixture, "scripts"), { recursive: true });
  cpSync(realGuardScript, join(fixture, "scripts", "guard-production-web-build.mjs"));
  if (withMarker) {
    writeFileSync(join(fixture, ".production-checkout"), "marker\n");
  }
  return fixture;
}

function runGuard(fixture: string, env: Record<string, string> = {}) {
  return spawnSync("node", [join(fixture, "scripts", "guard-production-web-build.mjs")], {
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

describe("guard-production-web-build.mjs", () => {
  it("allows the build when no .production-checkout marker exists (CI, local dev, an isolated release worktree)", () => {
    const fixture = makeFixtureRepo(false);
    const result = runGuard(fixture);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("refuses the build, with the exact required message, when the .production-checkout marker is present", () => {
    const fixture = makeFixtureRepo(true);
    const result = runGuard(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing to build web assets in the live production checkout.");
    expect(result.stderr).toContain("Use the isolated production deployment/release build.");
  });

  it("allows the build when the marker is present but the explicit DYO_RELEASE_BUILD=1 escape hatch is set", () => {
    const fixture = makeFixtureRepo(true);
    const result = runGuard(fixture, { DYO_RELEASE_BUILD: "1" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("still refuses when DYO_RELEASE_BUILD is set to anything other than exactly '1'", () => {
    const fixture = makeFixtureRepo(true);
    const result = runGuard(fixture, { DYO_RELEASE_BUILD: "true" });
    expect(result.status).not.toBe(0);
  });
});
