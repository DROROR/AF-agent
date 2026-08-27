// PM2 process definition for the DYO Contabo API.
// Reads real runtime config from the repo-root .env file (gitignored, never
// committed) so secrets never appear in this file, in `pm2 start` args, or in
// `ps`/shell history.
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(repoRoot, ".env");

// dyo-web serves an ISOLATED release directory, never the canonical
// checkout's own apps/web/.next - see scripts/lib/web-release.sh's own
// doc comment for the 2026-08-27 incident this exists to prevent (a
// developer/validation `npm run build` run directly in this checkout
// overwrote the exact .next directory the already-running production
// process was serving static assets from). `current` is a symlink,
// atomically re-pointed by scripts/switch-web-release.sh at one
// specific, already-built, already-verified release before every reload -
// see scripts/deploy-production.sh and scripts/create-web-release.sh.
const webReleasesRoot = process.env.DYO_WEB_RELEASES_ROOT || "/home/fahad/dyo-web-releases";
const webCurrentDir = path.join(webReleasesRoot, "current", "apps", "web");
const webCurrentBin = path.join(webReleasesRoot, "current", "node_modules", ".bin", "next");

function loadEnvFile(filePath) {
  const env = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

module.exports = {
  apps: [
    {
      name: "dyo-api",
      script: "apps/api/src/index.ts",
      interpreter: path.join(repoRoot, "node_modules", ".bin", "tsx"),
      cwd: repoRoot,
      // NODE_ENV: "production" here (not just implied by running under
      // PM2) is what makes production-runtime-guard.ts's startup check
      // meaningful - see that file's own doc comment for the incident
      // that prompted it.
      env: { ...loadEnvFile(envPath), NODE_ENV: "production" },
      max_restarts: 10,
      restart_delay: 2000,
      out_file: path.join(repoRoot, "logs", "dyo-api.out.log"),
      error_file: path.join(repoRoot, "logs", "dyo-api.error.log"),
      time: true
    },
    {
      // Read-only ops dashboard (Phase 3). Bound to 127.0.0.1 only - not
      // exposed publicly yet (no Nginx config in front of it) - see
      // docs/engineering/SECURITY.md and CLAUDE.md Phase 3 task 10/11.
      name: "dyo-web",
      script: webCurrentBin,
      args: ["start", "-H", "127.0.0.1", "-p", "4100"],
      cwd: webCurrentDir,
      env: {
        NODE_ENV: "production",
        // Loopback-only, server-side call from the dashboard to the API -
        // the browser never talks to the Fastify API directly.
        DYO_API_INTERNAL_URL: "http://127.0.0.1:4000"
      },
      max_restarts: 10,
      restart_delay: 2000,
      out_file: path.join(repoRoot, "logs", "dyo-web.out.log"),
      error_file: path.join(repoRoot, "logs", "dyo-web.error.log"),
      time: true
    }
  ]
};
