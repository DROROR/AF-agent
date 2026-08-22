import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildShotstackEditPayload,
  loadShotstackConfig,
  ShotstackClient,
  uploadAssetToShotstack,
  validateSceneMap,
  type SceneMap
} from "@dyo/renderer";

/**
 * Real Cognetica reference recreation POC - CLAUDE.md "Resume the
 * Cognitica/Cognetica Shotstack reference POC". Uses only real assets from
 * /opt/AF-agent/local-inputs/analysis/assets/ (extracted read-only from the
 * client's real zip archives - see docs/SHOTSTACK-REFERENCE-POC.md for the
 * full frame-by-frame derivation of every timestamp/asset/text value below).
 * SANDBOX ONLY. Refuses to run otherwise.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const ASSET_DIR = "/opt/AF-agent/local-inputs/analysis/assets";
const HEEBO_FONT_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/heebo/Heebo%5Bwght%5D.ttf";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 36; // ~3 minutes per render

function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Real background color sampled directly from the actual rendered reference frame (see docs/SHOTSTACK-REFERENCE-POC.md). */
const BACKGROUND_COLOR = "#FEF8FD";

async function main(): Promise<void> {
  loadDotEnv(path.join(REPO_ROOT, ".env"));
  const config = loadShotstackConfig();
  if (config.env !== "sandbox") {
    throw new Error(`Refusing to run: SHOTSTACK_ENV="${config.env}" - this POC must only run against "sandbox".`);
  }
  console.log(`Using Shotstack ${config.env} (${config.baseUrl}) - no production credits used.`);

  // --- Upload every unique real local asset once (dedup: the same 146.5s
  // screen recording is reused, at different trim points, for scenes 2/3/6-left).
  const uploadPlan = {
    logoCognetica: "logo-cognetica.png",
    appStoreBadges: "app-store-badges.png",
    openingVideo: "scene-opening.mp4",
    frame1Photo: "scene-opening-frame1.jpg",
    sharedRecording: "scene-2.mp4", // identical bytes to scene-3.mp4 and scene-6-left.mp4 - confirmed via md5sum
    frame4Video: "scene-4.mp4",
    frame5Photo: "scene-5.png",
    frame6RightVideo: "scene-6-right.mp4"
  } as const;

  const cachePath = path.join(ASSET_DIR, "..", "uploaded-urls-cache.json");
  let urls: Record<keyof typeof uploadPlan, string>;
  if (existsSync(cachePath)) {
    console.log(`Reusing already-uploaded asset URLs from ${cachePath}`);
    urls = JSON.parse(readFileSync(cachePath, "utf8")) as Record<keyof typeof uploadPlan, string>;
  } else {
    urls = {} as never;
    for (const [key, filename] of Object.entries(uploadPlan)) {
      const filePath = path.join(ASSET_DIR, filename);
      console.log(`Uploading ${filename}...`);
      const uploaded = await uploadAssetToShotstack(filePath, config);
      urls[key as keyof typeof uploadPlan] = uploaded.url;
      console.log(`  -> ${uploaded.url}`);
    }
  }

  // --- Real manual SceneMap, derived from ffprobe/ffmpeg frame analysis of
  // the actual rendered reference videos (not the work-map's stale "Source
  // Position" values) - see docs/SHOTSTACK-REFERENCE-POC.md for the full
  // derivation of every timestamp.
  const sceneMap: SceneMap = {
    projectId: "cognetica-reference-poc",
    brandColor: BACKGROUND_COLOR,
    logoAssetUrl: urls.logoCognetica,
    scenes: [
      {
        sceneId: "opening",
        label: "Opening Frame",
        startMs: 0,
        durationMs: 4500,
        assets: [
          { placeholderId: "opening-video", assetType: "VIDEO", sourceUrl: urls.openingVideo, trimSeconds: 2.5 }
        ],
        texts: [],
        phonePosition: "CENTER",
        transitionOut: { type: "FADE" }
      },
      {
        sceneId: "frame-1",
        label: "Frame 1",
        startMs: 4500,
        durationMs: 3500,
        assets: [
          { placeholderId: "frame1-photo", assetType: "IMAGE", sourceUrl: urls.frame1Photo },
          { placeholderId: "logo", assetType: "LOGO", sourceUrl: urls.logoCognetica }
        ],
        texts: [
          { placeholderId: "headline", content: "בית קוגנטיקה", fontFamily: "Heebo", fontWeight: 700 },
          { placeholderId: "subheadline", content: "הבית להתפתחות מקצועית של מטפלים", fontFamily: "Heebo" },
          {
            placeholderId: "branding",
            content: "עכשיו באפליקציה מבית DYO App",
            fontFamily: "Heebo",
            fontWeight: 700
          }
        ],
        phonePosition: "LEFT",
        transitionIn: { type: "FADE" },
        transitionOut: { type: "FADE" }
      },
      {
        sceneId: "frame-2",
        label: "Frame 2",
        startMs: 8000,
        durationMs: 4900,
        assets: [
          {
            placeholderId: "frame2-video",
            assetType: "VIDEO",
            sourceUrl: urls.sharedRecording,
            trimSeconds: 36
          }
        ],
        texts: [
          { placeholderId: "headline", content: "עולם שלם של הכשרות מקצועיות", fontFamily: "Heebo", fontWeight: 700 },
          { placeholderId: "subheadline", content: "כל הידע המקצועי במקום אחד", fontFamily: "Heebo" }
        ],
        phonePosition: "RIGHT",
        transitionIn: { type: "FADE" },
        transitionOut: { type: "FADE" }
      },
      {
        sceneId: "frame-3",
        label: "Frame 3",
        startMs: 12900,
        durationMs: 3100,
        assets: [
          {
            placeholderId: "frame3-video",
            assetType: "VIDEO",
            sourceUrl: urls.sharedRecording,
            trimSeconds: 22
          }
        ],
        texts: [{ placeholderId: "headline", content: "ידע שהופך לפרקטיקה", fontFamily: "Heebo", fontWeight: 700 }],
        phonePosition: "LEFT",
        transitionIn: { type: "FADE" },
        transitionOut: { type: "FADE" }
      },
      {
        sceneId: "frame-4",
        label: "Frame 4",
        startMs: 16000,
        durationMs: 4650,
        assets: [
          { placeholderId: "frame4-video", assetType: "VIDEO", sourceUrl: urls.frame4Video, trimSeconds: 2 }
        ],
        texts: [
          {
            placeholderId: "headline",
            content: "חוויית למידה שמלווה אותך בכל יום",
            fontFamily: "Heebo",
            fontWeight: 700
          },
          { placeholderId: "subheadline", content: "כל הידע שלך תמיד איתך", fontFamily: "Heebo" }
        ],
        phonePosition: "LEFT",
        transitionIn: { type: "FADE" },
        transitionOut: { type: "FADE" }
      },
      {
        sceneId: "frame-5",
        label: "Frame 5",
        startMs: 20650,
        durationMs: 4100,
        assets: [{ placeholderId: "frame5-photo", assetType: "IMAGE", sourceUrl: urls.frame5Photo }],
        texts: [
          { placeholderId: "headline", content: "מקום לשאול, לשתף, להתפתח", fontFamily: "Heebo", fontWeight: 700 },
          { placeholderId: "subheadline", content: "קהילה מקצועית אחת", fontFamily: "Heebo" }
        ],
        phonePosition: "RIGHT",
        transitionIn: { type: "FADE" },
        transitionOut: { type: "FADE" }
      },
      {
        sceneId: "frame-6",
        label: "Frame 6",
        startMs: 24750,
        durationMs: 6980,
        assets: [
          {
            placeholderId: "frame6-left",
            assetType: "VIDEO",
            sourceUrl: urls.sharedRecording,
            trimSeconds: 60,
            offsetX: -0.28
          },
          {
            placeholderId: "frame6-right",
            assetType: "VIDEO",
            sourceUrl: urls.frame6RightVideo,
            trimSeconds: 0,
            offsetX: 0.28
          },
          { placeholderId: "logo", assetType: "LOGO", sourceUrl: urls.logoCognetica }
        ],
        texts: [
          {
            placeholderId: "headline",
            content: "קוגנטיקה - מצוינות קלינית מתחילה כאן",
            fontFamily: "Heebo",
            fontWeight: 700
          },
          { placeholderId: "subheadline", content: "עכשיו בחנויות האפליקציות", fontFamily: "Heebo" }
        ],
        phonePosition: "CENTER",
        transitionIn: { type: "FADE" }
      }
    ]
  };

  const validation = validateSceneMap(sceneMap);
  console.log(`SceneMap validation: ${validation.valid ? "PASS" : "FAIL"}`, validation.errors);
  if (!validation.valid) {
    throw new Error("SceneMap failed brand-rule validation - refusing to render.");
  }

  const client = new ShotstackClient(config);

  async function renderAndPoll(label: string, outputKind: "LANDSCAPE" | "REELS") {
    const payload = buildShotstackEditPayload(sceneMap, outputKind, { fontUrls: [HEEBO_FONT_URL] });
    console.log(`\nSubmitting ${label} (${outputKind}) render...`);
    const { id } = await client.createRender(payload);
    console.log(`${label} render submitted: id=${id}`);

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
      await sleep(POLL_INTERVAL_MS);
      const status = await client.getRenderStatus(id);
      console.log(`[${label} poll ${attempt}] status=${status.status}`);
      if (status.status === "done") {
        console.log(`${label} RESULT: DONE. Output: ${status.url}`);
        return { id, status: "done", url: status.url };
      }
      if (status.status === "failed") {
        console.log(`${label} RESULT: FAILED. Error: ${status.error}`);
        return { id, status: "failed", url: null };
      }
    }
    console.log(`${label} RESULT: TIMED OUT after ${MAX_POLL_ATTEMPTS} polls.`);
    return { id, status: "timeout", url: null };
  }

  const landscapeResult = await renderAndPoll("Landscape", "LANDSCAPE");
  const verticalResult = await renderAndPoll("Vertical/Reels", "REELS");

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ landscapeResult, verticalResult }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Cognetica reference POC failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
