import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * REAL 2026-10-09 (QA project `mega`, Mixkit "Polaroid Slideshow"): a video
 * put into a picture slot could never be approved. The slot gate refuses to
 * judge fit from a filename, and a video's size was never measured at all
 * (probe-image-facts.ts reads PNG/JPEG/WebP headers and returns null for
 * everything else), so the plan stayed blocked on ASSET_DIMENSIONS_UNKNOWN
 * with no way to resolve it. The same would meet the client with their
 * first video upload.
 *
 * A video needs a real demuxer, so this asks ffprobe - the media tool the
 * architecture already relies on - for the first video stream's size and
 * the container's duration. It is a measurement, never a guess: when
 * ffprobe is missing, fails, or reports no video stream, the answer is
 * null and the gate keeps blocking honestly. Nothing here can fail an
 * upload.
 */
export interface VideoFacts {
  widthPx: number;
  heightPx: number;
  durationSeconds: number | null;
}

export type VideoFactsProbe = (buffer: Buffer, mimeType: string) => Promise<VideoFacts | null>;

const VIDEO_MIME_PREFIX = "video/";
const FFPROBE_TIMEOUT_MS = 60_000;

/** Pure: ffprobe's `-of json` output -> facts, or null when it holds no usable video stream. Exported for tests. */
export function parseFfprobeOutput(text: string): VideoFacts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const streams = (parsed as { streams?: unknown }).streams;
  const format = (parsed as { format?: unknown }).format;
  if (!Array.isArray(streams)) {
    return null;
  }
  const video = streams.find((stream): stream is { codec_type: string; width?: unknown; height?: unknown } => {
    return typeof stream === "object" && stream !== null && (stream as { codec_type?: unknown }).codec_type === "video";
  });
  if (!video) {
    return null;
  }
  const widthPx = Number(video.width);
  const heightPx = Number(video.height);
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx <= 0 || heightPx <= 0) {
    return null;
  }
  const rawDuration = typeof format === "object" && format !== null ? (format as { duration?: unknown }).duration : undefined;
  const durationSeconds = rawDuration === undefined || rawDuration === null ? NaN : Number(rawDuration);
  return { widthPx, heightPx, durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? durationSeconds : null };
}

function runFfprobe(ffprobePath: string, filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      ffprobePath,
      ["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", filePath],
      { timeout: FFPROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : String(stdout));
      }
    );
  });
}

/**
 * The real probe: the uploaded bytes go to a private temporary file (an
 * MP4's index may sit at its end, so a pipe is not enough), ffprobe reads
 * it, the file is removed whatever happens. Non-video types are not probed.
 */
export function createFfprobeVideoFactsProbe(ffprobePath = "ffprobe"): VideoFactsProbe {
  return async (buffer, mimeType) => {
    if (!mimeType.toLowerCase().startsWith(VIDEO_MIME_PREFIX)) {
      return null;
    }
    let dir: string | null = null;
    try {
      dir = await mkdtemp(join(tmpdir(), "dyo-video-probe-"));
      const filePath = join(dir, "upload.bin");
      await writeFile(filePath, buffer, { flag: "wx" });
      const output = await runFfprobe(ffprobePath, filePath);
      return output === null ? null : parseFfprobeOutput(output);
    } catch {
      return null;
    } finally {
      if (dir !== null) {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  };
}
