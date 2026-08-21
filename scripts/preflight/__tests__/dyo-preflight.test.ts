import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(currentDir, "..", "DYO-Preflight.ps1");
const batPath = join(currentDir, "..", "DYO-Preflight.bat");

const script = readFileSync(scriptPath, "utf8");
const bat = readFileSync(batPath, "utf8");

const REQUIRED_SECTIONS = [
  "MACHINE",
  "AFTER EFFECTS",
  "MCP",
  "DEPENDENCIES",
  "NETWORK",
  "POWER",
  "POC",
  "BLOCKERS",
  "READY_FOR_DEVELOPMENT"
];

// Cmdlets that mutate system/file state. The preflight tool must never call
// these - it is a read-only contract enforced by this test, not just a
// docstring. `Out-File` is intentionally excluded: it is used exactly once,
// to write the report itself.
const FORBIDDEN_CMDLET_PATTERNS = [
  /\bSet-\w+/,
  /\bRemove-\w+/,
  /\bClear-\w+/,
  /\bNew-Item\b/,
  /\bAdd-Content\b/,
  /\bSet-Content\b/,
  /\bRename-Item\b/,
  /\bMove-Item\b/,
  /\bCopy-Item\b/,
  /\bStop-Process\b/,
  /\bStop-Service\b/,
  /\bStart-Service\b/,
  /\bInstall-\w+/,
  /\bUninstall-\w+/,
  /\bDisable-\w+/,
  /\bEnable-\w+/,
  /\bRestart-\w+/
];

describe("DYO-Preflight.ps1 (read-only contract)", () => {
  it("documents the read-only contract in its header", () => {
    expect(script).toMatch(/READ-ONLY BY CONTRACT/);
  });

  it("emits every required report section", () => {
    for (const section of REQUIRED_SECTIONS) {
      expect(script.includes(section), `missing section marker: ${section}`).toBe(true);
    }
  });

  it("never calls a mutating cmdlet", () => {
    for (const pattern of FORBIDDEN_CMDLET_PATTERNS) {
      const match = script.match(pattern);
      expect(match, `forbidden mutating cmdlet found: ${match?.[0]}`).toBeNull();
    }
  });

  it("writes the report exactly once, and only the report", () => {
    const outFileCalls = script.match(/Out-File/g) ?? [];
    expect(outFileCalls.length).toBe(1);
  });

  it("never references saving or overwriting a .aep file", () => {
    // Only read-oriented cmdlets may appear near ".aep" in this script.
    const aepLines = script.split("\n").filter((line) => line.includes(".aep"));
    for (const line of aepLines) {
      expect(line).not.toMatch(/Set-Content|Out-File|Add-Content|Remove-Item|\.Save\(/);
    }
  });

  it("bat launcher delegates to the ps1 script without hard-coded parameters", () => {
    expect(bat).toMatch(/DYO-Preflight\.ps1/);
    expect(bat).toMatch(/%\*/);
  });
});
