#!/usr/bin/env node
// Assembles deploy/windows-worker/worker-app/ - a flat, pre-compiled copy of
// apps/worker + packages/schemas that DYO-Worker-Setup.ps1 copies onto the
// client machine and runs with plain `node`. Flat (not an npm workspace
// symlink) so it works standalone once copied off this machine, and
// pre-compiled (not TS-via-tsx) so the client only needs Node itself - no
// devDependency, no TypeScript toolchain, no build step on their side.
//
// Run: node scripts/package-windows-worker.mjs
// (rebuilds apps/worker and packages/schemas first, so the bundle always
// reflects current source - never hand-edit files under worker-app/, they
// are regenerated from src/ on every run.)

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const WORKER_APP_DIR = path.join(REPO_ROOT, "deploy", "windows-worker", "worker-app");

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** Copies compiled dist output, excluding test artifacts (*.test.js/.d.ts/.js.map) - the client never needs these. */
function copyDistExcludingTests(fromDir, toDir) {
  cpSync(fromDir, toDir, {
    recursive: true,
    filter: (src) => !/\.test\.(js|d\.ts|js\.map)$/.test(src)
  });
}

console.log("Rebuilding @dyo/schemas and @dyo/worker...");
run("npm", ["--workspace", "@dyo/schemas", "run", "build"], REPO_ROOT);
run("npm", ["--workspace", "@dyo/worker", "run", "build"], REPO_ROOT);

console.log(`Assembling ${path.relative(REPO_ROOT, WORKER_APP_DIR)}...`);
rmSync(WORKER_APP_DIR, { recursive: true, force: true });
mkdirSync(WORKER_APP_DIR, { recursive: true });

// @dyo/schemas - flat copy with a package.json pointing at compiled JS
// (the real workspace package.json points "main" at ./src/index.ts, which
// only works because the monorepo's dev/test tooling loads TS directly -
// plain `node` on the client machine cannot).
const schemasSrcPkg = readJson(path.join(REPO_ROOT, "packages", "schemas", "package.json"));
const schemasOutDir = path.join(WORKER_APP_DIR, "schemas");
mkdirSync(path.join(schemasOutDir, "dist"), { recursive: true });
copyDistExcludingTests(
  path.join(REPO_ROOT, "packages", "schemas", "dist"),
  path.join(schemasOutDir, "dist")
);
writeJson(path.join(schemasOutDir, "package.json"), {
  name: schemasSrcPkg.name,
  version: schemasSrcPkg.version,
  private: true,
  type: "module",
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  dependencies: schemasSrcPkg.dependencies
});

// @dyo/worker - flat copy, dist only, plus a package.json with @dyo/schemas
// pointed at the sibling copy via `file:` (npm turns this into a real
// node_modules entry on `npm install`, so the unmodified "@dyo/schemas"
// import specifiers in the compiled JS keep resolving correctly).
const workerSrcPkg = readJson(path.join(REPO_ROOT, "apps", "worker", "package.json"));
mkdirSync(path.join(WORKER_APP_DIR, "dist"), { recursive: true });
copyDistExcludingTests(
  path.join(REPO_ROOT, "apps", "worker", "dist"),
  path.join(WORKER_APP_DIR, "dist")
);
writeJson(path.join(WORKER_APP_DIR, "package.json"), {
  name: "dyo-windows-worker-runtime",
  version: workerSrcPkg.version,
  private: true,
  type: "module",
  main: "./dist/index.js",
  dependencies: {
    "@dyo/schemas": "file:./schemas",
    ...Object.fromEntries(
      Object.entries(workerSrcPkg.dependencies).filter(([name]) => name !== "@dyo/schemas")
    )
  }
});

// Presentation-only status formatter for DYO-Worker-Start.bat - never part
// of apps/worker itself, copied in verbatim (already plain JS, no build step).
cpSync(
  path.join(REPO_ROOT, "scripts", "windows-worker-format-status.mjs"),
  path.join(WORKER_APP_DIR, "dist", "format-status.js")
);

// Manual-troubleshooting wrapper (double-click to run in the foreground) -
// kept for that purpose, but no longer what the Scheduled Task itself
// invokes (see run-worker-supervisor.ps1 below) - see its own header
// comment for why this is a plain .bat rather than an inline cmd.exe /c string.
cpSync(
  path.join(REPO_ROOT, "scripts", "windows-worker-run-wrapper.bat"),
  path.join(WORKER_APP_DIR, "run-worker.bat")
);

// The hidden supervisor launcher the Scheduled Task's Action now actually
// invokes (via `powershell.exe -WindowStyle Hidden -File
// run-worker-supervisor.ps1`) - see its own header comment. Fixes the real
// production bug where a visible, session-attached console window let an
// external console-control event (or the window simply being closed) kill
// the worker with no restart.
cpSync(
  path.join(REPO_ROOT, "scripts", "windows-worker-supervisor-launcher.ps1"),
  path.join(WORKER_APP_DIR, "run-worker-supervisor.ps1")
);

// Node-level env validator DYO-Worker-Setup.ps1 invokes via the real
// `node --env-file=.env` mechanism, proving what Node itself sees rather
// than trusting PowerShell's (BOM-transparent) view of the same file.
cpSync(
  path.join(REPO_ROOT, "scripts", "windows-worker-validate-env.mjs"),
  path.join(WORKER_APP_DIR, "dist", "validate-env.js")
);

// Harmless build/version marker (commit + build time, never a secret) -
// version.ts reads this at worker startup and logs it, so worker.log can
// prove exactly which build produced a given heartbeat/job after an
// update package is installed.
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }).toString().trim();
writeJson(path.join(WORKER_APP_DIR, "BUILD_INFO.json"), { commit, builtAt: new Date().toISOString() });

console.log("Done. worker-app/ contains no devDependencies and no TypeScript source - plain compiled JS + a minimal package.json, ready for `npm install --omit=dev` on the client machine.");
