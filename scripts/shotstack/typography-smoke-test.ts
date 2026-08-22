import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  loadShotstackConfig,
  ShotstackClient,
  ShotstackRenderer,
  type SceneMap
} from "@dyo/renderer";

/**
 * Live Shotstack SANDBOX smoke test for the single highest-risk requirement:
 * Hebrew + Heebo typography. Deliberately bounded - this does not build
 * reference-video analysis, does not touch the After Effects architecture,
 * and only runs against SHOTSTACK_ENV=sandbox (refuses to run otherwise).
 *
 * Run manually: npm run shotstack:typography-smoke-test
 * Requires SHOTSTACK_API_KEY in the repo-root .env (never committed).
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const HEEBO_FONT_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/heebo/Heebo%5Bwght%5D.ttf";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 24; // ~2 minutes

/** Same minimal pattern already used in deploy/pm2/ecosystem.config.cjs - no new dependency (e.g. dotenv) just for this. */
function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(eq + 1);
    }
  }
}

function buildTypographySmokeTestSceneMap(): SceneMap {
  return {
    projectId: "shotstack-typography-smoke-test",
    brandColor: "#101820",
    scenes: [
      {
        sceneId: "scene-1",
        label: "Typography smoke test",
        startMs: 0,
        durationMs: 5000,
        assets: [],
        texts: [
          {
            placeholderId: "line-1",
            content: "מבית DYO App",
            fontFamily: "Heebo",
            fontWeight: 700,
            color: "#FFFFFF"
          },
          {
            placeholderId: "line-2",
            content: "בדיקת טיפוגרפיה בעברית",
            fontFamily: "Heebo",
            fontWeight: 700,
            color: "#FFFFFF"
          },
          {
            placeholderId: "line-3",
            content: "DYO App",
            fontFamily: "Heebo",
            fontWeight: 700,
            color: "#FFFFFF"
          }
        ]
      }
    ]
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  loadDotEnv(path.join(REPO_ROOT, ".env"));

  const config = loadShotstackConfig();
  if (config.env !== "sandbox") {
    throw new Error(
      `Refusing to run: SHOTSTACK_ENV="${config.env}", but this smoke test must only run against "sandbox".`
    );
  }
  console.log(`Using Shotstack ${config.env} (${config.baseUrl}) - no production credits used.`);

  const client = new ShotstackClient(config);
  const renderer = new ShotstackRenderer(client, { fontUrls: [HEEBO_FONT_URL] });

  const sceneMap = buildTypographySmokeTestSceneMap();
  const validation = await renderer.validateProject(sceneMap);
  if (!validation.valid) {
    console.log(
      "Note: validateProject reported violations expected for this text-only smoke test (no logo asset is used here):",
      validation.errors
    );
  }

  console.log("Submitting render to Shotstack sandbox...");
  const handle = await renderer.renderReels(sceneMap);
  console.log(`Render submitted: provider=${handle.provider} id=${handle.externalId}`);

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    const status = await renderer.getRenderStatus(handle);
    console.log(`[poll ${attempt}] providerStatus=${status.providerStatus} -> ${status.status}`);

    if (status.status === "DONE") {
      console.log("RESULT: DONE");
      console.log(`Render ID: ${handle.externalId}`);
      console.log(`Output URL: ${status.outputUrl}`);
      return;
    }
    if (status.status === "FAILED") {
      console.log("RESULT: FAILED");
      console.log(`Render ID: ${handle.externalId}`);
      console.log(`Message: ${status.message}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `RESULT: TIMED OUT after ${MAX_POLL_ATTEMPTS} polling attempts - render ID ${handle.externalId} may still complete; check it manually later.`
  );
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Typography smoke test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
