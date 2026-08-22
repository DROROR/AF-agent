// PM2 process definition for the DYO Contabo API.
// Reads real runtime config from the repo-root .env file (gitignored, never
// committed) so secrets never appear in this file, in `pm2 start` args, or in
// `ps`/shell history.
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(repoRoot, ".env");

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
      env: loadEnvFile(envPath),
      max_restarts: 10,
      restart_delay: 2000,
      out_file: path.join(repoRoot, "logs", "dyo-api.out.log"),
      error_file: path.join(repoRoot, "logs", "dyo-api.error.log"),
      time: true
    }
  ]
};
