import { describe, expect, it } from "vitest";
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
    this.lastScript = script;
    return this.result;
  }
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

    const result = await inspector.inspect();

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
    await inspector.inspect();
    expect(fake.lastScript).toContain("DYO INSPECT_RENDER_CAPABILITIES");
    expect(fake.lastScript).toContain("app.project.renderQueue.items.add(");
  });

  it("surfaces an AE-side typed failure (e.g. no composition exists) without throwing", async () => {
    const fake = new FakeMutationClient({
      ok: true,
      content: hostRunJsxContent({ ok: false, failureReason: "no composition exists in this project to enumerate render templates against" })
    });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect();
    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason).toContain("no composition exists");
  });

  it("surfaces a tool-call failure (ae_run_jsx itself failed) as a typed failure", async () => {
    const fake = new FakeMutationClient({ ok: false, error: { code: "TOOL_ERROR", message: "comp not found" } });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect();
    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") return;
    expect(result.reason).toContain("TOOL_ERROR");
  });

  it("fails closed on a malformed AE-side response rather than fabricating a template list", async () => {
    const fake = new FakeMutationClient({ ok: true, content: hostRunJsxContent({ somethingElse: true }) });
    const inspector = new HeroicSwanRenderCapabilitiesInspector({ createMutationClient: () => fake });

    const result = await inspector.inspect();
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

    const result = await inspector.inspect();
    expect(result.kind).toBe("failure");
    expect(closeCalls).toBe(1);
  });
});

describe("NotAvailableRenderCapabilitiesInspector", () => {
  it("never fabricates a result - always throws RenderCapabilitiesInspectorUnavailableError", async () => {
    const inspector = new NotAvailableRenderCapabilitiesInspector();
    await expect(inspector.inspect()).rejects.toBeInstanceOf(RenderCapabilitiesInspectorUnavailableError);
  });
});
