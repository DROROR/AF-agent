import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CreateFullPreviewRequest } from "@dyo/schemas";
import { executeCreateFullPreview } from "../create-full-preview-executor.js";
import type { AerenderRunner, AerenderRunParams, AerenderRunResult } from "../../render/aerender-runner.js";
import type { CompositionVerifier, VerifyRenderCompositionResult } from "../../render/verify-render-composition.js";
import type { FullPreviewUploader, UploadFullPreviewParams, UploadFullPreviewResult } from "../upload-full-preview.js";
import { fullPreviewOutputPath } from "../full-preview-output-path.js";
import { sessionWorkingCopyPath } from "../../../workspace/working-copy.js";

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

const EXECUTION_SESSION_ID = "prior-session";

function makeFixture() {
  const workRoot = mkdtempSync(join(tmpdir(), "preview-executor-test-"));
  cleanupDirs.push(workRoot);
  const sourcePath = join(workRoot, "source.aep");
  const sourceContent = Buffer.from("original source aep bytes");
  writeFileSync(sourcePath, sourceContent);

  const workingPath = sessionWorkingCopyPath(workRoot, EXECUTION_SESSION_ID);
  mkdirSync(join(workingPath, ".."), { recursive: true });
  const workingContent = Buffer.from("edited working copy aep bytes");
  writeFileSync(workingPath, workingContent);

  return { workRoot, sourcePath, sourceSha: sha256(sourceContent), workingPath, workingSha: sha256(workingContent) };
}

function makeRequest(fixture: ReturnType<typeof makeFixture>, overrides: Partial<CreateFullPreviewRequest> = {}): CreateFullPreviewRequest {
  return {
    projectId: "11111111-1111-1111-1111-111111111111",
    executionSessionId: EXECUTION_SESSION_ID,
    sourceProjectPath: fixture.sourcePath,
    sourceProjectSha256: fixture.sourceSha,
    expectedWorkingProjectSha256: fixture.workingSha,
    aeProjectItemIndex: 5,
    compositionName: "Landscape Master",
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Source",
    ...overrides
  };
}

class FakeCompositionVerifier implements CompositionVerifier {
  calls = 0;
  constructor(private readonly result: VerifyRenderCompositionResult = { ok: true }) {}
  async verify(): Promise<VerifyRenderCompositionResult> {
    this.calls++;
    return this.result;
  }
}

class FakeAerenderRunner implements AerenderRunner {
  calls: AerenderRunParams[] = [];
  constructor(
    private readonly behavior: (params: AerenderRunParams, callIndex: number) => Omit<AerenderRunResult, "startedAt" | "completedAt"> & {
      writeBytes?: Buffer;
    }
  ) {}

  async run(params: AerenderRunParams): Promise<AerenderRunResult> {
    const callIndex = this.calls.length;
    this.calls.push(params);
    const startedAt = new Date().toISOString();
    const { writeBytes, ...rest } = this.behavior(params, callIndex);
    if (rest.ok && rest.exitCode === 0 && writeBytes) {
      mkdirSync(join(params.outputPath, ".."), { recursive: true });
      writeFileSync(params.outputPath, writeBytes);
    }
    return { ...rest, startedAt, completedAt: new Date().toISOString() };
  }
}

function alwaysSucceedingRunner(bytes = 10): FakeAerenderRunner {
  return new FakeAerenderRunner(() => ({
    ok: true,
    pid: 1234,
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "rendered ok",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    spawnError: null,
    writeBytes: Buffer.alloc(bytes, 1)
  }));
}

class FakeFullPreviewUploader implements FullPreviewUploader {
  calls: UploadFullPreviewParams[] = [];
  constructor(private readonly result: UploadFullPreviewResult = { ok: true }) {}
  async upload(params: UploadFullPreviewParams): Promise<UploadFullPreviewResult> {
    this.calls.push(params);
    return this.result;
  }
}

function alwaysSucceedingUploader(): FakeFullPreviewUploader {
  return new FakeFullPreviewUploader({ ok: true });
}

describe("executeCreateFullPreview", () => {
  it("happy path: verifies working copy + composition, runs aerender, validates, and uploads a real artifact", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
    const runner = alwaysSucceedingRunner(42);
    const verifier = new FakeCompositionVerifier();
    const uploader = alwaysSucceedingUploader();

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: verifier, fullPreviewUploader: uploader, now: () => new Date() },
      "job-1",
      request
    );

    expect(result.failureReason).toBeNull();
    expect(result.artifact).not.toBeNull();
    expect(result.artifact?.byteSize).toBe(42);
    expect(result.artifact?.mimeType).toBe("video/mp4");
    expect(result.workingProjectSha256).toBe(fixture.workingSha);
    expect(runner.calls).toHaveLength(1);
    expect(verifier.calls).toBe(1);

    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]).toEqual({ jobId: "job-1", filePath: fullPreviewOutputPath(fixture.workRoot, "job-1"), mimeType: "video/mp4" });

    // Original source untouched.
    expect(readFileSync(fixture.sourcePath)).toEqual(Buffer.from("original source aep bytes"));
  });

  it("reports a typed failure (never throws) when AERENDER_PATH is not configured", async () => {
    const fixture = makeFixture();
    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: undefined, aerenderRunner: alwaysSucceedingRunner(), compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-2",
      makeRequest(fixture)
    );
    expect(result.failureReason).toContain("AERENDER_PATH is not configured");
    expect(result.artifact).toBeNull();
  });

  it("fails when the working copy sha256 does not match - never touches the verifier or aerender", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture, { expectedWorkingProjectSha256: "f".repeat(64) });
    const verifier = new FakeCompositionVerifier();
    const runner = alwaysSucceedingRunner();

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: verifier, fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-3",
      request
    );

    expect(result.failureReason).toContain("does not match the expected sha256");
    expect(verifier.calls).toBe(0);
    expect(runner.calls).toHaveLength(0);
  });

  it("fails closed with a clear message when no working copy exists yet for this execution session", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture, { executionSessionId: "a-session-with-no-scene-edits-yet" });

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: alwaysSucceedingRunner(), compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-4",
      request
    );

    expect(result.failureReason).toContain("no working copy found for this execution session");
  });

  it("never previews the original source .aep - refuses when the derived working copy path resolves to the same file", async () => {
    const fixture = makeFixture();
    // Force the derivation to collide by pointing sourceProjectPath at the real working copy path.
    const request = makeRequest(fixture, { sourceProjectPath: fixture.workingPath });

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: alwaysSucceedingRunner(), compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-5",
      request
    );

    expect(result.failureReason).toContain("refusing to preview the original .aep");
  });

  it("fails when the original source .aep no longer matches its expected sha256, even before creating the preview", async () => {
    const fixture = makeFixture();
    writeFileSync(fixture.sourcePath, Buffer.from("TAMPERED"));
    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: alwaysSucceedingRunner(), compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-6",
      makeRequest(fixture)
    );
    expect(result.failureReason).toContain("original source .aep could not be verified as unchanged");
  });

  it("fails when composition verification fails, and never invokes aerender", async () => {
    const fixture = makeFixture();
    const runner = alwaysSucceedingRunner();
    const verifier = new FakeCompositionVerifier({ ok: false, reason: "composition name is ambiguous" });

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: verifier, fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-7",
      makeRequest(fixture)
    );

    expect(result.failureReason).toContain("composition verification failed");
    expect(runner.calls).toHaveLength(0);
  });

  it("fails when aerender cannot be spawned at all", async () => {
    const fixture = makeFixture();
    const runner = new FakeAerenderRunner(() => ({
      ok: false,
      pid: null,
      exitCode: null,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      spawnError: "ENOENT: no such file or directory"
    }));

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-8",
      makeRequest(fixture)
    );

    expect(result.failureReason).toContain("aerender could not be started");
    expect(result.artifact).toBeNull();
  });

  it("fails when aerender times out", async () => {
    const fixture = makeFixture();
    const runner = new FakeAerenderRunner(() => ({
      ok: true,
      pid: 1,
      exitCode: null,
      signal: "SIGKILL",
      timedOut: true,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      spawnError: null
    }));

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-9",
      makeRequest(fixture)
    );

    expect(result.failureReason).toContain("timed out");
  });

  it("fails when aerender exits non-zero, including a stderr excerpt", async () => {
    const fixture = makeFixture();
    const runner = new FakeAerenderRunner(() => ({
      ok: true,
      pid: 1,
      exitCode: 2,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "ERROR: missing font",
      stdoutTruncated: false,
      stderrTruncated: false,
      spawnError: null
    }));

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-10",
      makeRequest(fixture)
    );

    expect(result.failureReason).toContain("exited with code 2");
    expect(result.failureReason).toContain("missing font");
  });

  it("fails validation when aerender reports success but never actually wrote the output file - never a metadata-only fabrication of readiness", async () => {
    const fixture = makeFixture();
    const runner = new FakeAerenderRunner(() => ({
      ok: true,
      pid: 1,
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      spawnError: null
      // no writeBytes - simulates a "lying" success with no real output file
    }));

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-11",
      makeRequest(fixture)
    );

    expect(result.failureReason).toContain("complete-preview artifact validation failed");
    expect(result.artifact).toBeNull();
  });

  it("removes a stale pre-existing output file before rendering, so a re-dispatched attempt can never pass validation on the old file alone", async () => {
    const fixture = makeFixture();
    const outputPath = fullPreviewOutputPath(fixture.workRoot, "job-12");
    mkdirSync(join(outputPath, ".."), { recursive: true });
    writeFileSync(outputPath, Buffer.alloc(999, 9)); // a big stale "previous attempt" file

    const runner = alwaysSucceedingRunner(3); // this attempt's REAL output is only 3 bytes
    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-12",
      makeRequest(fixture)
    );

    expect(result.failureReason).toBeNull();
    expect(result.artifact?.byteSize).toBe(3); // proves the stale 999-byte file was really removed, never silently reused
  });

  it("reports a recoverable failure (never throws) when the upload itself fails, even though rendering/validation both succeeded", async () => {
    const fixture = makeFixture();
    const runner = alwaysSucceedingRunner(42);
    const uploader = new FakeFullPreviewUploader({ ok: false, reason: "storage unavailable" });

    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: uploader, now: () => new Date() },
      "job-13",
      makeRequest(fixture)
    );

    expect(uploader.calls).toHaveLength(1);
    expect(result.failureReason).toContain("complete-preview upload failed");
    expect(result.failureReason).toContain("storage unavailable");
    // Never claims a real artifact once the bytes never actually reached durable storage.
    expect(result.artifact).toBeNull();
  });

  it("creating a preview never approves it and never triggers a final render - the result carries no such field", async () => {
    const fixture = makeFixture();
    const result = await executeCreateFullPreview(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: alwaysSucceedingRunner(), compositionVerifier: new FakeCompositionVerifier(), fullPreviewUploader: alwaysSucceedingUploader(), now: () => new Date() },
      "job-14",
      makeRequest(fixture)
    );
    expect(result).not.toHaveProperty("approved");
    expect(result).not.toHaveProperty("renderDispatched");
  });
});
