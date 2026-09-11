import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeroicSwanCompositionVerifier, NotAvailableCompositionVerifier, CompositionVerifierUnavailableError } from "../verify-render-composition.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-verify-render-composition-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type OpenBehavior =
  | "echo" // default: reports back whatever path buildOpenProjectScript's own `new File(...)` literal was called with - simulates a real, successful open of the SAME path verify() was given, so every pre-existing test (which never cared about the open step) keeps passing unchanged.
  | { openedPath: string | null } // forces a specific (possibly mismatched, possibly null/"no project") reported open path, regardless of what was requested.
  | "toolError" // simulates ae_run_jsx itself failing (isError: true).
  | "scriptFailure"; // simulates the open-project script's own {ok:false, failureReason} path (e.g. app.open() returned falsy).

/** A real fake ae-mcp MCP server exposing ae_list_compositions and ae_run_jsx (now genuinely used by the real 2026-09-11 fix for its own open-project check) with a caller-configured composition list and open-project behavior. */
async function writeFakeServer(aeMcpPath: string, compositions: { index: number; name: string }[], openBehavior: OpenBehavior = "echo"): Promise<void> {
  await mkdir(join(aeMcpPath, "dist"), { recursive: true });
  const sdkEsmRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  const list = compositions.map((c) => ({
    index: c.index,
    name: c.name,
    width: 1080,
    height: 1920,
    frameRate: 30,
    duration: 4,
    numLayers: 1
  }));
  await writeFile(
    join(aeMcpPath, "dist", "index.js"),
    `
(async () => {
  const { McpServer } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "mcp.js"))});
  const { StdioServerTransport } = await import(${JSON.stringify(join(sdkEsmRoot, "server", "stdio.js"))});
  const { z } = await import(${JSON.stringify(join(process.cwd(), "node_modules", "zod", "index.js"))});

  const server = new McpServer({ name: "fake-ae-mcp-render", version: "0.0.0" });

  server.registerTool("ae_list_compositions", { description: "d" }, async () => {
    return { content: [{ type: "text", text: JSON.stringify(${JSON.stringify(list)}) }] };
  });

  server.registerTool("ae_run_jsx", { description: "d", inputSchema: { code: z.string(), args: z.record(z.string(), z.unknown()).optional(), mode: z.string().optional() } }, async (args) => {
    const openBehavior = ${JSON.stringify(openBehavior)};
    if (openBehavior === "toolError") {
      return { isError: true, content: [{ type: "text", text: "simulated ae_run_jsx failure" }] };
    }
    let inner;
    if (openBehavior === "scriptFailure") {
      inner = JSON.stringify({ ok: false, failureReason: "app.open() did not return an opened project" });
    } else {
      let openedPath;
      if (openBehavior === "echo") {
        const match = /new File\\((".*?")\\)/.exec(args.code);
        openedPath = match ? JSON.parse(match[1]) : null;
      } else {
        openedPath = openBehavior.openedPath;
      }
      inner = JSON.stringify({ ok: true, resultingValue: { openedPath, openedName: openedPath } });
    }
    // Real upstream double-envelope (see unwrap-jsx-result.ts's own doc comment): { result: "<script's own JSON.stringify string>" }.
    return { content: [{ type: "text", text: JSON.stringify({ result: inner }) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

describe("HeroicSwanCompositionVerifier - real spawned MCP server, not mocked", () => {
  it("succeeds when aeProjectItemIndex resolves to a composition with the exact expected name, unambiguous, and the working copy is genuinely open", async () => {
    await writeFakeServer(dir, [
      { index: 1, name: "Intro" },
      { index: 5, name: "Landscape Master" },
      { index: 9, name: "Reels Master" }
    ]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 5, compositionName: "Landscape Master" });
    expect(result.ok).toBe(true);
  });

  /**
   * Real 2026-09-10 incident fix (session a7fee3d9) - the caller
   * (render-project-executor.ts/create-full-preview-executor.ts) needs
   * the composition's own real duration/frameRate to compute an explicit
   * full-composition -s/-e frame range for aerender, from the SAME
   * ae_list_compositions scan this verification already performs.
   */
  it("returns the composition's own real durationSeconds/frameRate on success - from the SAME ae_list_compositions scan, zero extra cost", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // writeFakeServer's own fixed fixture values (frameRate: 30, duration: 4) - real, read back, never fabricated by the verifier itself.
    expect(result.durationSeconds).toBe(4);
    expect(result.frameRate).toBe(30);
  });

  it("fails when aeProjectItemIndex does not resolve to any composition", async () => {
    await writeFakeServer(dir, [{ index: 1, name: "Intro" }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 99, compositionName: "Landscape Master" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not resolve");
  });

  it("fails closed when the resolved composition's real name does not match the expected name", async () => {
    await writeFakeServer(dir, [{ index: 5, name: "Some Other Scene" }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 5, compositionName: "Landscape Master" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("resolved to composition");
    expect(result.reason).toContain("Some Other Scene");
  });

  it("fails closed on an ambiguous duplicate name, even though the exact index matches", async () => {
    await writeFakeServer(dir, [
      { index: 5, name: "Landscape Master" },
      { index: 12, name: "Landscape Master" }
    ]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 5, compositionName: "Landscape Master" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("ambiguous");
  });

  /**
   * Real 2026-09-11 incident (job 47b0b42f-bbec-4ee5-a6f1-0132591a4a89):
   * CREATE_PREVIEW failed with "aeProjectItemIndex 3 does not resolve to
   * any composition in this project" while AE was actually sitting on
   * Untitled/Home - this verifier called ae_list_compositions against
   * whatever project happened to be open (none), never having opened or
   * checked the session's own real working copy first. These tests prove
   * the fix: an explicit open-project check now runs BEFORE
   * ae_list_compositions is ever called, and fails closed with an honest,
   * specific reason - never falling through to the confusing
   * "does not resolve" message - whenever that check does not confirm the
   * exact expected working copy is open.
   */
  it("fails closed with an honest reason (never the confusing 'does not resolve' message) when NO project is open in AE at verify time - the real incident shape", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], { openedPath: null });
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/work/jobs/session-a7fee3d9/working-copy.aep", aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no project");
    expect(result.reason).not.toContain("does not resolve");
  });

  it("fails closed when a DIFFERENT project is open in AE than the requested working copy", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], { openedPath: "C:\\DYO-Agent\\source-template.aep" });
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "C:\\DYO-Agent\\jobs\\session-a7fee3d9\\working-copy.aep", aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("source-template.aep");
    expect(result.reason).toContain("refusing to verify a composition against the wrong project");
  });

  it("fails closed when the open-project script itself reports a script-level failure (e.g. app.open() returned falsy)", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], "scriptFailure");
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("app.open()");
  });

  it("fails closed when ae_run_jsx itself errors while trying to open the working copy", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], "toolError");
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("simulated ae_run_jsx failure");
  });

  it("never derives or accepts the immutable source .aep - this function's only path parameter is workingProjectPath, and a mismatched open never falls back to trying anything else", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], { openedPath: "/some/unrelated/project.aep" });
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/work/jobs/session-a7fee3d9/working-copy.aep", aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("/work/jobs/session-a7fee3d9/working-copy.aep");
  });
});

describe("NotAvailableCompositionVerifier", () => {
  it("never fabricates a result - always throws CompositionVerifierUnavailableError", async () => {
    const verifier = new NotAvailableCompositionVerifier();
    await expect(verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 1, compositionName: "X" })).rejects.toBeInstanceOf(
      CompositionVerifierUnavailableError
    );
  });
});
