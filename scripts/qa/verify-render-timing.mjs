#!/usr/bin/env node
/**
 * MVP acceptance check: "timestamp accuracy within one source frame".
 *
 * Compares a rendered video against the SOURCE composition it was rendered
 * from, as the template manifest reports that composition - never against a
 * hardcoded expectation, and never against a number typed by whoever runs
 * this. Any template, any frame rate, any duration.
 *
 * The check is deliberately expressed in FRAMES rather than seconds: a
 * tolerance in seconds means something different at 24fps than at 60fps, and
 * the acceptance criterion is written in frames.
 *
 * Usage:
 *   node scripts/qa/verify-render-timing.mjs <manifest.json> <compositionName> <rendered.mp4>
 *
 * Exit code 0 when the drift is within one source frame, 1 otherwise, so this
 * can gate a release rather than merely printing something for a human to
 * skim past.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [manifestPath, compositionName, renderedPath] = process.argv.slice(2);
if (!manifestPath || !compositionName || !renderedPath) {
  console.error("usage: verify-render-timing.mjs <manifest.json> <compositionName> <rendered.mp4>");
  process.exit(2);
}

/** Accepts either a bare manifest or any of the job-result envelopes the API returns it inside. */
function readManifest(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const candidates = [raw, raw.manifest, raw?.response?.manifest, raw?.job?.result?.response?.manifest, raw?.result?.response?.manifest];
  const found = candidates.find((candidate) => candidate && Array.isArray(candidate.compositions));
  if (!found) {
    throw new Error(`${path} does not contain a template manifest with a compositions array`);
  }
  return found;
}

function probe(path) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=r_frame_rate,nb_frames", "-show_entries", "format=duration", "-of", "json", path],
    { encoding: "utf8" }
  );
  const parsed = JSON.parse(out);
  const stream = (parsed.streams ?? []).find((candidate) => candidate.r_frame_rate && candidate.r_frame_rate !== "0/0");
  if (!stream) {
    throw new Error(`${path} has no video stream with a readable frame rate`);
  }
  const [num, den] = String(stream.r_frame_rate).split("/");
  return {
    frameRate: Number(num) / Number(den || 1),
    // nb_frames is absent in some containers; the duration x rate fallback is
    // reported as such rather than silently presented as a counted value.
    frameCount: stream.nb_frames === undefined ? null : Number(stream.nb_frames),
    durationSeconds: Number(parsed.format?.duration)
  };
}

const manifest = readManifest(manifestPath);
const composition = manifest.compositions.find((candidate) => candidate.name === compositionName);
if (!composition) {
  console.error(`composition "${compositionName}" is not in this manifest. It holds: ${manifest.compositions.map((c) => c.name).join(", ")}`);
  process.exit(2);
}

const actual = probe(renderedPath);
const expectedFrames = Math.round(composition.durationSeconds * composition.frameRate);
const actualFrames = actual.frameCount ?? Math.round(actual.durationSeconds * actual.frameRate);
const driftFrames = actualFrames - expectedFrames;
const rateMatches = Math.abs(actual.frameRate - composition.frameRate) < 0.01;

console.log(`source   ${composition.name}: ${composition.durationSeconds}s @ ${composition.frameRate}fps = ${expectedFrames} frames`);
console.log(`rendered ${renderedPath}: ${actual.durationSeconds}s @ ${actual.frameRate}fps = ${actualFrames} frames${actual.frameCount === null ? " (derived, not counted)" : ""}`);
console.log(`drift    ${driftFrames} frame(s); frame rate ${rateMatches ? "matches" : "DIFFERS"}`);

if (!rateMatches) {
  console.error("FAIL: the rendered frame rate is not the source composition's own frame rate.");
  process.exit(1);
}
if (Math.abs(driftFrames) > 1) {
  console.error(`FAIL: drift of ${driftFrames} frames exceeds the one-frame acceptance tolerance.`);
  process.exit(1);
}
console.log("PASS: within one source frame.");
