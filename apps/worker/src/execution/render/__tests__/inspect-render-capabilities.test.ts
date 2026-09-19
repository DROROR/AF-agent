import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HeroicSwanRenderCapabilitiesInspector,
  NotAvailableRenderCapabilitiesInspector,
  RenderCapabilitiesInspectorUnavailableError
} from "../inspect-render-capabilities.js";
import type { AeMutationClient } from "../../ae-edit-bridge.js";
import type { MutationCallResult } from "../../heroic-swan-ae-mutation-client.js";
import type { FixedJsxScript } from "../../jsx-templates.js";

/** Mirrors the exact real double-envelope shape ae_run_jsx returns (see ae-edit-bridge.test.ts's own identical helper). */
function hostRunJsxContent(scriptResult: unknown): unknown {
  return [{ type: "text", text: JSON.stringify({ result: JSON.stringify(scriptResult) }) }];
}

/**
 * Stage 3: this inspection now runs through the disposable-project wrapper, so
 * the fake answers the wrapper's own fixed scripts (open-project state,
 * footage check, open, close) exactly as a healthy, empty After Effects would,
 * and returns the test's canned result only for the capability script itself.
 */
class FakeMutationClient implements AeMutationClient {
  connectCalls = 0;
  closeCalls = 0;
  lastScript: FixedJsxScript | null = null;
  constructor(private readonly result: MutationCallResult) {}
  async connect(): Promise<void> {
    this.connectCalls++;
  }
  async close(): Promise<void> {
    this.closeCalls++;
  }
  async runFixedOperation(script: FixedJsxScript): Promise<MutationCallResult> {
    const text = script as unknown as string;
    if (text.includes("DYO_SAFE_INSPECTION_DESCRIBE_STATE")) {
      return { ok: true, content: hostRunJsxContent({ ok: true, resultingValue: { projectOpen: false, projectPath: null, projectName: null, itemCount: 0, dirty: null, dirtyAvailable: true } }) };
    }
    if (text.includes("DYO_SAFE_INSPECTION_DESCRIBE_FOOTAGE")) {
      return { ok: true, content: hostRunJsxContent({ ok: true, resultingValue: { footageItemsChecked: 0, missing: [] } }) };
    }
    if (text.includes("DYO_SAFE_INSPECTION_CLOSE_DISPOSABLE")) {
      return { ok: true, content: hostRunJsxContent({ ok: true, resultingValue: { closed: true, openPath: null } }) };
    }
    if (text.includes("app.open(")) {
      const requested = /new File\((".*?")\)/.exec(text)?.[1];
      const openedPath = requested ? (JSON.parse(requested) as string) : null;
      return { ok: true, content: hostRunJsxContent({ ok: true, resultingValue: { openedPath, openedName: "copy" } }) };
    }
    this.lastScript = script;
    return this.result;
  }
}

let dir: string;
/** A REAL project file, because the wrapper genuinely hashes and copies it before anything is opened. */
let projectPath: string;
let projectSha256: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-inspect-render-capabilities-"));
  projectPath = join(dir, "project.aep");
  await writeFile(projectPath, "fake-aep-bytes", "utf8");
  projectSha256 = createHash("sha256").update("fake-aep-bytes").digest("hex");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The project this inspection is pointed at - Stage 3 requires one to be named. */
function namedProject() {
  return { sourceProjectPath: projectPath, sourceProjectSha256: projectSha256 };
}

describe("HeroicSwanRenderCapabilitiesInspector", () => {
  it("returns the real reported template name lists on success, and always closes the client", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({
        ok: true,
        renderSettingsTemplateNames: ["Best Settings", "DV Settings"],
        outputModuleTemplateNames: ["H.264 - Match Source", "Lossless"]
      })
    });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect(namedProject());

    expect(result.kind).toBe("capabilities");
    if (result.kind !== "capabilities") return;
    expect(result.response.renderSettingsTemplateNames).toEqual(["Best Settings", "DV Settings"]);
    expect(result.response.outputModuleTemplateNames).toEqual(["H.264 - Match Source", "Lossless"]);
    expect(result.response.aeVersion).toBeNull();
    expect(fake.connectCalls).toBe(1);
    expect(fake.closeCalls).toBe(1);
  });

  it("sends the real buildInspectRenderCapabilitiesScript, never an arbitrary script", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: true, renderSettingsTemplateNames: [], outputModuleTemplateNames: [] })
    });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });
    await inspector.inspect(namedProject());
    expect(fake.lastScript).toContain("DYO INSPECT_RENDER_CAPABILITIES");
    expect(fake.lastScript).toContain("app.project.renderQueue.items.add(");
  });

  it("surfaces an AE-side typed failure (e.g. no composition exists) without throwing", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: false, failureReason: "no composition exists in this project to enumerate render templates against" })
    });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect(namedProject());
    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason).toContain("no composition exists");
  });

  it("surfaces a tool-call failure (ae_run_jsx itself failed) as a typed failure", async () => {
    const fake = new FakeMutationClient({ ok: false, error: { code: "TOOL_ERROR", message: "comp not found" } });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect(namedProject());
    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason).toContain("TOOL_ERROR");
  });

  it("fails closed on a malformed AE-side response rather than fabricating a template list", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ somethingElse: true }) });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect(namedProject());
    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason).toContain("did not match the expected shape");
  });

  it("closes the client even when connect() itself throws", async () => {
    let closeCalls = 0;
    const throwingClient: AeMutationClient = {
      connect: () => Promise.reject(new Error("spawn failed")),
      close: async () => {
        closeCalls++;
      },
      runFixedOperation: () => Promise.reject(new Error("should never be called"))
    };
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => throwingClient });

    const result = await inspector.inspect(namedProject());
    expect(result.kind).toBe("failure");
    expect(closeCalls).toBe(1);
  });
});

describe("NotAvailableRenderCapabilitiesInspector", () => {
  it("never fabricates a result - always throws RenderCapabilitiesInspectorUnavailableError", async () => {
    const inspector = new NotAvailableRenderCapabilitiesInspector();
    await expect(inspector.inspect(namedProject())).rejects.toBeInstanceOf(RenderCapabilitiesInspectorUnavailableError);
  });
});

describe("HeroicSwanRenderCapabilitiesInspector - Stage 3 safe inspection", () => {
  it("refuses when no project is named, rather than reading whatever After Effects happens to hold", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ ok: true, renderSettingsTemplateNames: [], outputModuleTemplateNames: [] }) });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect();

    expect(result.kind).toBe("failure");
    expect(result.kind === "failure" && result.reason).toContain("no project was named");
    // Nothing was opened, and the client was never even connected for a read.
    expect(fake.lastScript).toBeNull();
  });

  it("reports the safe-inspection evidence alongside the templates it read", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: true, renderSettingsTemplateNames: ["Best Settings"], outputModuleTemplateNames: ["Lossless"] })
    });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect(namedProject());

    expect(result.kind).toBe("capabilities");
    if (result.kind !== "capabilities") return;
    const evidence = result.response.safeInspection;
    expect(evidence?.targetPath).toBe(projectPath);
    expect(evidence?.disposablePath).toContain(".dyo-inspect-");
    expect(evidence?.sourceSha256Before).toBe(projectSha256);
    expect(evidence?.sourceSha256After).toBe(projectSha256);
    expect(evidence?.cleanup).toBe("DELETED");
    expect(evidence?.restoration).toBe("NOTHING_TO_RESTORE");
  });
});
