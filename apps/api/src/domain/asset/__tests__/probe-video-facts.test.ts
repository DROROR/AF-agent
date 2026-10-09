import { describe, expect, it } from "vitest";
import { createFfprobeVideoFactsProbe, parseFfprobeOutput } from "../probe-video-facts.js";

describe("parseFfprobeOutput (real 2026-10-09: a video in a picture slot could never be approved)", () => {
  it("reads the first video stream's size and the container duration", () => {
    const facts = parseFfprobeOutput(
      JSON.stringify({ streams: [{ codec_type: "audio" }, { codec_type: "video", width: 1920, height: 1080 }], format: { duration: "44.833333" } })
    );
    expect(facts).toEqual({ widthPx: 1920, heightPx: 1080, durationSeconds: 44.833333 });
  });

  it("a missing or unusable duration is null, never a guess - the size still counts", () => {
    expect(parseFfprobeOutput(JSON.stringify({ streams: [{ codec_type: "video", width: 640, height: 360 }], format: {} }))).toEqual({ widthPx: 640, heightPx: 360, durationSeconds: null });
    expect(parseFfprobeOutput(JSON.stringify({ streams: [{ codec_type: "video", width: 640, height: 360 }], format: { duration: "N/A" } }))?.durationSeconds).toBeNull();
  });

  it("no video stream, a zero size, or output that is not JSON is null", () => {
    expect(parseFfprobeOutput(JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "3" } }))).toBeNull();
    expect(parseFfprobeOutput(JSON.stringify({ streams: [{ codec_type: "video", width: 0, height: 0 }] }))).toBeNull();
    expect(parseFfprobeOutput("not json")).toBeNull();
    expect(parseFfprobeOutput("null")).toBeNull();
  });
});

describe("createFfprobeVideoFactsProbe", () => {
  it("never probes a non-video type", async () => {
    const probe = createFfprobeVideoFactsProbe("/definitely/not/ffprobe");
    expect(await probe(Buffer.from("png"), "image/png")).toBeNull();
  });

  it("a missing ffprobe binary is null, never a thrown upload failure", async () => {
    const probe = createFfprobeVideoFactsProbe("/definitely/not/ffprobe");
    expect(await probe(Buffer.from("mp4 bytes"), "video/mp4")).toBeNull();
  });
});
