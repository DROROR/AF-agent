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

/**
 * A manifestCompositionId with NO parseable numeric AE id - the exact
 * shape a BUILD_HORIZONTAL_COMPOSITION/BUILD_REELS_COMPOSITION-derived
 * master composition actually gets today (see register-horizontal-
 * composition.ts's own `deterministicId([...])` call and resolve-
 * composition-index.ts's own parseStableCompositionNumericId doc
 * comment) - used by every test below that is NOT specifically about the
 * new id-based resolution, so those tests keep exercising exactly the
 * pre-existing "trust the caller-supplied index" behavior, unchanged.
 */
const DERIVED_MASTER_ID = "landscape-master-derived-abc123";

type OpenBehavior =
  | "echo" // default: reports back whatever path buildOpenProjectScript's own `new File(...)` literal was called with - simulates a real, successful open of the SAME path verify() was given, so every pre-existing test (which never cared about the open step) keeps passing unchanged.
  | { openedPath: string | null } // forces a specific (possibly mismatched, possibly null/"no project") reported open path, regardless of what was requested.
  | "toolError" // simulates ae_run_jsx itself failing (isError: true).
  | "scriptFailure"; // simulates the open-project script's own {ok:false, failureReason} path (e.g. app.open() returned falsy).

/** A real fake ae-mcp MCP server exposing ae_list_compositions and ae_run_jsx (now genuinely used both by the 2026-09-11 open-project check AND the 2026-09-11 resolve-composition-by-id fix) with a caller-configured composition list (each optionally carrying its own real AE `id`, used only by the resolve-by-id script) and open-project behavior. */
async function writeFakeServer(
  aeMcpPath: string,
  compositions: { index: number; name: string; id?: number }[],
  openBehavior: OpenBehavior = "echo"
): Promise<void> {
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
  const idLookup = compositions.filter((c) => c.id !== undefined).map((c) => ({ id: c.id, index: c.index, name: c.name }));
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
    const idLookup = ${JSON.stringify(idLookup)};

    // Distinguish the two real, fixed scripts this verifier ever sends by
    // a unique substring each one's own undo-group label carries - the
    // fake server never parses/executes the script, only classifies it.
    if (args.code.indexOf("DYO RESOLVE_COMPOSITION_INDEX") !== -1) {
      const idMatch = /__candidate\\.id === (\\d+)/.exec(args.code);
      const nameMatch = /__found\\.name !== (".*?")/.exec(args.code);
      const expectedId = idMatch ? Number(idMatch[1]) : null;
      const expectedName = nameMatch ? JSON.parse(nameMatch[1]) : null;
      const found = idLookup.find((c) => c.id === expectedId);
      let inner;
      if (!found) {
        inner = JSON.stringify({ ok: false, failureReason: "no composition with id " + expectedId + " exists in this project" });
      } else if (found.name !== expectedName) {
        inner = JSON.stringify({ ok: false, failureReason: "composition id " + expectedId + " now has name \\"" + found.name + "\\", expected \\"" + expectedName + "\\"" });
      } else {
        inner = JSON.stringify({ ok: true, resolvedAeProjectItemIndex: found.index, name: found.name, widthPx: 1080, heightPx: 1920, frameRate: 30, durationSeconds: 4 });
      }
      return { content: [{ type: "text", text: JSON.stringify({ result: inner }) }] };
    }

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
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 5, compositionName: "Landscape Master" });
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
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // writeFakeServer's own fixed fixture values (frameRate: 30, duration: 4) - real, read back, never fabricated by the verifier itself.
    expect(result.durationSeconds).toBe(4);
    expect(result.frameRate).toBe(30);
  });

  it("fails when aeProjectItemIndex does not resolve to any composition", async () => {
    await writeFakeServer(dir, [{ index: 1, name: "Intro" }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 99, compositionName: "Landscape Master" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not resolve");
  });

  it("fails closed when the resolved composition's real name does not match the expected name", async () => {
    await writeFakeServer(dir, [{ index: 5, name: "Some Other Scene" }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 5, compositionName: "Landscape Master" });
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
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 5, compositionName: "Landscape Master" });
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
    const result = await verifier.verify({
      workingProjectPath: "/work/jobs/session-a7fee3d9/working-copy.aep",
      manifestCompositionId: DERIVED_MASTER_ID,
      aeProjectItemIndex: 3,
      compositionName: "!Render (Landscape)"
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no project");
    expect(result.reason).not.toContain("does not resolve");
  });

  it("fails closed when a DIFFERENT project is open in AE than the requested working copy", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], { openedPath: "C:\\DYO-Agent\\source-template.aep" });
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({
      workingProjectPath: "C:\\DYO-Agent\\jobs\\session-a7fee3d9\\working-copy.aep",
      manifestCompositionId: DERIVED_MASTER_ID,
      aeProjectItemIndex: 3,
      compositionName: "!Render (Landscape)"
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("source-template.aep");
    expect(result.reason).toContain("refusing to verify a composition against the wrong project");
  });

  it("fails closed when the open-project script itself reports a script-level failure (e.g. app.open() returned falsy)", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], "scriptFailure");
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("app.open()");
  });

  it("fails closed when ae_run_jsx itself errors while trying to open the working copy", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], "toolError");
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("simulated ae_run_jsx failure");
  });

  it("never derives or accepts the immutable source .aep - this function's only path parameter is workingProjectPath, and a mismatched open never falls back to trying anything else", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }], { openedPath: "/some/unrelated/project.aep" });
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({
      workingProjectPath: "/work/jobs/session-a7fee3d9/working-copy.aep",
      manifestCompositionId: DERIVED_MASTER_ID,
      aeProjectItemIndex: 3,
      compositionName: "!Render (Landscape)"
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("/work/jobs/session-a7fee3d9/working-copy.aep");
  });

  /**
   * CRITICAL SAFETY FIX (real 2026-09-11 incident, job
   * 47b0b42f-bbec-4ee5-a6f1-0132591a4a89): "comp-1" (Scene 1)'s own
   * persisted aeProjectItemIndex went stale after a later
   * BUILD_HORIZONTAL_COMPOSITION inserted a new project item and shifted
   * every later index - AE then reported index 48 as "Pre-comp 5"
   * instead of "Scene 1". These tests prove the fix: when
   * manifestCompositionId has a real, durable numeric AE id
   * ("comp-<N>"), the verifier re-resolves the CURRENT real index by
   * that id BEFORE ever trusting the caller-supplied (possibly stale)
   * one - and still succeeds even though the supplied index is
   * completely wrong, because the composition itself simply moved.
   */
  it("real 2026-09-11 incident fix: re-resolves by the manifest's durable numeric id and succeeds even though the caller-supplied index has drifted to point at a totally different composition", async () => {
    // "comp-1" now really lives at index 48 - the caller-supplied index (1, its own OLD/stale value) points at nothing useful.
    await writeFakeServer(dir, [
      { index: 1, name: "Pre-comp 5" },
      { index: 48, name: "Scene 1", id: 1 }
    ]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: "comp-1", aeProjectItemIndex: 1, compositionName: "Scene 1" });
    expect(result.ok).toBe(true);
  });

  it("real 2026-09-11 incident: fails closed with an honest, specific reason (never falls back to the stale index) when a durable id no longer resolves to anything", async () => {
    await writeFakeServer(dir, [{ index: 1, name: "Pre-comp 5" }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: "comp-1", aeProjectItemIndex: 1, compositionName: "Scene 1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("could not re-resolve composition");
    expect(result.reason).toContain("comp-1");
    expect(result.reason).toContain("no composition with id 1 exists");
  });

  it("real 2026-09-11 incident: fails closed when an id match resolves to a composition whose name no longer matches - never silently trusted", async () => {
    await writeFakeServer(dir, [{ index: 48, name: "Something Else Entirely", id: 1 }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: "comp-1", aeProjectItemIndex: 1, compositionName: "Scene 1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("could not re-resolve composition");
    expect(result.reason).toContain("Something Else Entirely");
  });

  it("a composition with no durable numeric id (a BUILD_HORIZONTAL_COMPOSITION/BUILD_REELS_COMPOSITION-derived master) falls back to trusting the caller-supplied index unchanged - no regression", async () => {
    await writeFakeServer(dir, [{ index: 3, name: "!Render (Landscape)" }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    // manifestCompositionId here is a synthetic deterministicId, never "comp-<N>" - parseStableCompositionNumericId must return null, so no resolve script is ever sent (proven by the fact this still succeeds even with no `id` in the fixture at all).
    const result = await verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 3, compositionName: "!Render (Landscape)" });
    expect(result.ok).toBe(true);
  });
});

describe("NotAvailableCompositionVerifier", () => {
  it("never fabricates a result - always throws CompositionVerifierUnavailableError", async () => {
    const verifier = new NotAvailableCompositionVerifier();
    await expect(
      verifier.verify({ workingProjectPath: "/w.aep", manifestCompositionId: DERIVED_MASTER_ID, aeProjectItemIndex: 1, compositionName: "X" })
    ).rejects.toBeInstanceOf(CompositionVerifierUnavailableError);
  });
});
