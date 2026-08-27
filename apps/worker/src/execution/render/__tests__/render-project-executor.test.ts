import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderProjectRequest, RenderCheckpoint } from "@dyo/schemas";
import { executeRenderProject } from "../render-project-executor.js";
import type { AerenderRunner, AerenderRunParams, AerenderRunResult } from "../aerender-runner.js";
import type { CompositionVerifier, VerifyRenderCompositionResult } from "../verify-render-composition.js";
import type { RenderArtifactUploader, UploadRenderArtifactParams, UploadRenderArtifactResult } from "../upload-render-artifact.js";
import { renderOutputPath } from "../render-output-path.js";
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
  const workRoot = mkdtempSync(join(tmpdir(), "render-executor-test-"));
  cleanupDirs.push(workRoot);
  const sourcePath = join(workRoot, "source.aep");
  const sourceContent = Buffer.from("original source aep bytes");
  writeFileSync(sourcePath, sourceContent);

  // The worker derives this path itself from (workRoot, executionSessionId) -
  // never from a request field - so the fixture writes the "prior scene
  // edit's" working copy at exactly that derived location.
  const workingPath = sessionWorkingCopyPath(workRoot, EXECUTION_SESSION_ID);
  mkdirSync(join(workingPath, ".."), { recursive: true });
  const workingContent = Buffer.from("edited working copy aep bytes");
  writeFileSync(workingPath, workingContent);

  return {
    workRoot,
    sourcePath,
    sourceSha: sha256(sourceContent),
    workingPath,
    workingSha: sha256(workingContent)
  };
}

function makeRequest(fixture: ReturnType<typeof makeFixture>, overrides: Partial<RenderProjectRequest> = {}): RenderProjectRequest {
  return {
    projectId: "11111111-1111-1111-1111-111111111111",
    planId: "plan-1",
    planRevision: 1,
    variant: "LANDSCAPE",
    sourceProjectPath: fixture.sourcePath,
    sourceProjectSha256: fixture.sourceSha,
    executionSessionId: EXECUTION_SESSION_ID,
    expectedWorkingProjectSha256: fixture.workingSha,
    aeProjectItemIndex: 5,
    compositionName: "Landscape Master",
    renderSettingsTemplateName: "Best Settings",
    outputModuleTemplateName: "H.264 - Match Source",
    checkpoint: null,
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

/** Simulates a real aerender: on success, actually writes bytes to the requested output path - mirroring the real CLI's own side effect - so downstream artifact validation is exercised against a real file. */
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

const noopPersist = async (): Promise<{ ok: true } | { ok: false; reason: string }> => ({ ok: true });

class FakeArtifactUploader implements RenderArtifactUploader {
  calls: UploadRenderArtifactParams[] = [];
  constructor(private readonly result: UploadRenderArtifactResult = { ok: true }) {}
  async upload(params: UploadRenderArtifactParams): Promise<UploadRenderArtifactResult> {
    this.calls.push(params);
    return this.result;
  }
}

function alwaysSucceedingUploader(): FakeArtifactUploader {
  return new FakeArtifactUploader({ ok: true });
}

describe("executeRenderProject", () => {
  it("happy path: all 4 stages complete and a valid artifact is produced", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
    const runner = alwaysSucceedingRunner(42);
    const verifier = new FakeCompositionVerifier();
    const uploader = alwaysSucceedingUploader();

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: verifier, artifactUploader: uploader, persistCheckpoint: noopPersist, now: () => new Date() },
      "job-1",
      request
    );

    expect(result.failureReason).toBeNull();
    expect(result.artifact).not.toBeNull();
    expect(result.artifact?.validationStatus).toBe("VALID");
    expect(result.artifact?.byteSize).toBe(42);
    expect(result.artifact?.variant).toBe("LANDSCAPE");
    expect(result.checkpoint.completedOperationIndices.sort()).toEqual([0, 1, 2, 3]);
    expect(runner.calls).toHaveLength(1);
    expect(verifier.calls).toBe(1);

    // The real validated output file is uploaded exactly once, from the
    // same path VALIDATE_ARTIFACT itself just proved exists.
    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]).toEqual({
      jobId: "job-1",
      variant: "LANDSCAPE",
      filePath: renderOutputPath(fixture.workRoot, "job-1", "LANDSCAPE"),
      mimeType: "video/mp4"
    });

    // Original source untouched.
    expect(readFileSync(fixture.sourcePath)).toEqual(Buffer.from("original source aep bytes"));
  });

  it("marks the artifact INVALID and the checkpoint failed when the upload itself fails, even though rendering/validation both succeeded", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
    const runner = alwaysSucceedingRunner(42);
    const verifier = new FakeCompositionVerifier();
    const uploader = new FakeArtifactUploader({ ok: false, reason: "storage unavailable" });

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: verifier, artifactUploader: uploader, persistCheckpoint: noopPersist, now: () => new Date() },
      "job-1",
      request
    );

    expect(uploader.calls).toHaveLength(1);
    expect(result.failureReason).toContain("artifact upload failed");
    expect(result.failureReason).toContain("storage unavailable");
    expect(result.artifact?.validationStatus).toBe("INVALID");
    expect(result.artifact?.validationFailureReason).toContain("upload failed");
    // All 4 render stages themselves still genuinely completed - only the
    // subsequent, non-stage upload step failed.
    expect(result.checkpoint.completedOperationIndices.sort()).toEqual([0, 1, 2, 3]);
  });

  it("fails at VERIFY_WORKING_COPY when the working copy sha256 does not match - never touches the verifier or aerender", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture, { expectedWorkingProjectSha256: "f".repeat(64) });
    const runner = alwaysSucceedingRunner();
    const verifier = new FakeCompositionVerifier();

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: verifier, artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-2",
      request
    );

    expect(result.failureReason).toContain("does not match the expected sha256");
    expect(verifier.calls).toBe(0);
    expect(runner.calls).toHaveLength(0);
  });

  it("fails closed with a clear message when no working copy exists yet for this execution session - never derives one from the original source", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture, { executionSessionId: "a-session-with-no-scene-edits-yet" });

    const result = await executeRenderProject(
      {
        workRoot: fixture.workRoot,
        aerenderPath: "/fake/aerender",
        aerenderRunner: alwaysSucceedingRunner(),
        compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(),
        persistCheckpoint: noopPersist,
        now: () => new Date()
      },
      "job-3",
      request
    );

    expect(result.failureReason).toContain("no working copy found for this execution session");
  });

  it("fails when the original source .aep no longer matches its expected sha256, even before rendering", async () => {
    const fixture = makeFixture();
    writeFileSync(fixture.sourcePath, Buffer.from("TAMPERED"));
    const request = makeRequest(fixture);

    const result = await executeRenderProject(
      {
        workRoot: fixture.workRoot,
        aerenderPath: "/fake/aerender",
        aerenderRunner: alwaysSucceedingRunner(),
        compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(),
        persistCheckpoint: noopPersist,
        now: () => new Date()
      },
      "job-4",
      request
    );

    expect(result.failureReason).toContain("original source .aep could not be verified as unchanged");
  });

  it("fails when composition verification fails, and never invokes aerender", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
    const runner = alwaysSucceedingRunner();
    const verifier = new FakeCompositionVerifier({ ok: false, reason: "composition name is ambiguous" });

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: verifier, artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-5",
      request
    );

    expect(result.failureReason).toContain("composition verification failed");
    expect(result.failureReason).toContain("ambiguous");
    expect(runner.calls).toHaveLength(0);
  });

  it("fails when aerender cannot be spawned at all", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
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

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-6",
      request
    );

    expect(result.failureReason).toContain("aerender could not be started");
    expect(result.artifact).toBeNull();
  });

  it("fails when aerender times out", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
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

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-7",
      request
    );

    expect(result.failureReason).toContain("timed out");
  });

  it("fails when aerender exits non-zero, including a stderr excerpt", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
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

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-8",
      request
    );

    expect(result.failureReason).toContain("exited with code 2");
    expect(result.failureReason).toContain("missing font");
  });

  it("fails validation when aerender reports success but never actually wrote the output file", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
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

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-9",
      request
    );

    expect(result.failureReason).toContain("artifact validation failed");
    expect(result.artifact?.validationStatus).toBe("INVALID");
  });

  it("removes a stale pre-existing output file before rendering, so it can never pass validation on its own", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
    const outputPath = renderOutputPath(fixture.workRoot, "job-10", "LANDSCAPE");
    mkdirSync(join(outputPath, ".."), { recursive: true });
    writeFileSync(outputPath, Buffer.alloc(999, 9)); // a big stale "previous" file

    const runner = alwaysSucceedingRunner(3); // this attempt's REAL output is only 3 bytes
    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-10",
      request
    );

    expect(result.failureReason).toBeNull();
    expect(result.artifact?.byteSize).toBe(3); // proves the stale 999-byte file was really removed, never silently reused
  });

  it("pauses (never invokes aerender) when checkpoint persistence fails after an earlier stage completes", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);
    const runner = alwaysSucceedingRunner();
    const persistCheckpoint = vi.fn(async () => ({ ok: false as const, reason: "network error" }));

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint, now: () => new Date() },
      "job-11",
      request
    );

    expect(result.failureReason).toContain("checkpoint persistence failed");
    expect(runner.calls).toHaveLength(0); // paused after stage 0, before ever reaching RUN_AERENDER
    expect(persistCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("crash/resume: a fresh process resuming after RUN_AERENDER was durably marked complete (by an EARLIER process) re-validates rather than fabricating render-timing facts, and reports a typed failure asking for a fresh job attempt", async () => {
    const fixture = makeFixture();
    const priorCheckpoint: RenderCheckpoint = {
      completedOperationIndices: [0, 1, 2],
      checkpointBeforeAt: "2026-01-01T00:00:00.000Z",
      checkpointAfterAt: "2026-01-01T00:00:01.000Z",
      failureReason: null
    };
    const request = makeRequest(fixture, { checkpoint: priorCheckpoint });
    const runner = alwaysSucceedingRunner();

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-12",
      request
    );

    expect(runner.calls).toHaveLength(0); // this process never re-ran aerender
    expect(result.failureReason).toContain("dispatch a fresh RENDER job attempt");
  });

  it("resuming from a durably-persisted [0,1] checkpoint (stage 2's own persist failed previously) re-attempts RUN_AERENDER fresh and succeeds", async () => {
    const fixture = makeFixture();
    const priorCheckpoint: RenderCheckpoint = {
      completedOperationIndices: [0, 1],
      checkpointBeforeAt: "2026-01-01T00:00:00.000Z",
      checkpointAfterAt: "2026-01-01T00:00:01.000Z",
      failureReason: "checkpoint persistence failed after stage 2 completed: simulated crash"
    };
    const request = makeRequest(fixture, { checkpoint: priorCheckpoint });
    const runner = alwaysSucceedingRunner(7);

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: "/fake/aerender", aerenderRunner: runner, compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-13",
      request
    );

    expect(runner.calls).toHaveLength(1); // re-ran RUN_AERENDER since it was never durably completed
    expect(result.failureReason).toBeNull();
    expect(result.artifact?.byteSize).toBe(7);
  });

  it("reports a typed failure (never throws) when AERENDER_PATH is not configured", async () => {
    const fixture = makeFixture();
    const request = makeRequest(fixture);

    const result = await executeRenderProject(
      { workRoot: fixture.workRoot, aerenderPath: undefined, aerenderRunner: alwaysSucceedingRunner(), compositionVerifier: new FakeCompositionVerifier(),
        artifactUploader: alwaysSucceedingUploader(), persistCheckpoint: noopPersist, now: () => new Date() },
      "job-14",
      request
    );

    expect(result.failureReason).toContain("AERENDER_PATH is not configured");
  });
});
