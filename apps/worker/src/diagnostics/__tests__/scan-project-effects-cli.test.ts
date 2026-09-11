import { describe, expect, it } from "vitest";
import { buildOpenProjectScript as realBuildOpenProjectScript, buildScanProjectEffectsScript as realBuildScanProjectEffectsScript } from "../../execution/jsx-templates.js";
import { buildOpenProjectScript, buildScanProjectEffectsScript } from "../scan-project-effects-cli.js";

/**
 * Real 2026-09-11 incident: this standalone CLI deliberately duplicates
 * two script bodies from jsx-templates.ts (rather than importing them)
 * so it never depends on a compiled sibling file that could be stale on
 * an already-installed Worker machine (see the CLI's own doc comment for
 * the full incident - copying only the new .js file onto an older
 * install broke with "does not provide an export named
 * buildScanProjectEffectsScript"). That deliberate duplication is only
 * safe as long as the two copies never silently drift apart - these
 * tests fail loudly the moment they do, forcing an intentional,
 * synchronized update to both files rather than an unnoticed divergence.
 */
describe("scan-project-effects-cli.ts's duplicated scripts stay byte-identical to jsx-templates.ts's real ones", () => {
  it("buildOpenProjectScript produces the exact same JSX as jsx-templates.ts's real function", () => {
    const path = "C:\\DYO-Agent\\copies\\scratch.aep";
    expect(buildOpenProjectScript(path)).toBe(realBuildOpenProjectScript(path) as unknown as string);
  });

  it("buildScanProjectEffectsScript produces the exact same JSX as jsx-templates.ts's real function", () => {
    expect(buildScanProjectEffectsScript()).toBe(realBuildScanProjectEffectsScript() as unknown as string);
  });
});
