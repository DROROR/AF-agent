#!/usr/bin/env node
// Refuses `next build` (invoked via apps/web's own `prebuild` script) when
// run directly inside the flagged live production checkout - see the
// 2026-08-27 incident this exists to prevent from ever recurring: a
// developer/validation `npm run build` overwrote the exact .next
// directory the already-running production dyo-web process was serving
// static assets from.
//
// Detection is an explicit marker FILE ($repoRoot/.production-checkout)
// rather than a hostname/path guess - created once, out-of-band, only on
// the real production server, and gitignored so it is never present in a
// CI checkout, a fresh clone, a developer's own machine, or an isolated
// release worktree created by scripts/create-web-release.sh (`git
// worktree add` only populates tracked files, never this untracked
// marker) - so none of those are ever affected by this guard.
//
// DYO_RELEASE_BUILD=1 is the one documented escape hatch, for a
// deliberate, reviewed exception - never set by habit, and not needed by
// the normal release flow (which builds in an unmarked worktree anyway).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function shouldRefuseWebBuild(repoRoot, env) {
  const marker = join(repoRoot, ".production-checkout");
  return existsSync(marker) && env["DYO_RELEASE_BUILD"] !== "1";
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (shouldRefuseWebBuild(repoRoot, process.env)) {
    console.error("Refusing to build web assets in the live production checkout.\nUse the isolated production deployment/release build.");
    process.exit(1);
  }
}
