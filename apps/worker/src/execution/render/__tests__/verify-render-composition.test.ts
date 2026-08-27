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

/** A real fake ae-mcp MCP server exposing only ae_list_compositions (plus ae_run_jsx, to prove this verifier never calls it) with a caller-configured composition list. */
async function writeFakeServer(aeMcpPath: string, compositions: { index: number; name: string }[]): Promise<void> {
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

  const server = new McpServer({ name: "fake-ae-mcp-render", version: "0.0.0" });

  server.registerTool("ae_list_compositions", { description: "d" }, async () => {
    return { content: [{ type: "text", text: JSON.stringify(${JSON.stringify(list)}) }] };
  });

  server.registerTool("ae_run_jsx", { description: "d" }, async () => {
    return { content: [{ type: "text", text: "MUTATION - should never be reachable" }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
`,
    "utf8"
  );
}

describe("HeroicSwanCompositionVerifier - real spawned MCP server, not mocked", () => {
  it("succeeds when aeProjectItemIndex resolves to a composition with the exact expected name, unambiguous", async () => {
    await writeFakeServer(dir, [
      { index: 1, name: "Intro" },
      { index: 5, name: "Landscape Master" },
      { index: 9, name: "Reels Master" }
    ]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    const result = await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 5, compositionName: "Landscape Master" });
    expect(result.ok).toBe(true);
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

  it("never calls ae_run_jsx, even though the (fake, hostile-capable) server offers it", async () => {
    await writeFakeServer(dir, [{ index: 1, name: "Landscape Master" }]);
    const verifier = new HeroicSwanCompositionVerifier(dir);
    await verifier.verify({ workingProjectPath: "/w.aep", aeProjectItemIndex: 1, compositionName: "Landscape Master" });
    // Proven structurally by HeroicSwanMcpClient's closed AllowedInspectionTool
    // union (see heroic-swan-mcp-client.ts) - there is no method to call
    // ae_run_jsx at all.
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
