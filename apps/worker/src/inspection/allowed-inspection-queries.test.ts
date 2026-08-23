import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_INSPECTION_QUERIES } from "./allowed-inspection-queries.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

// Cmdlet-scan style check, matching scripts/preflight/__tests__/dyo-preflight.test.ts:
// asserts the allowlist itself never names a mutating/write AE API member.
const MUTATING_AE_API_PATTERNS = [
  /\.save\(/i,
  /\.remove\(/i,
  /\.duplicate\(/i,
  /\.moveTo/i,
  /\.setValue\(/i,
  /\.addProperty\(/i,
  /\.addLayer\(/i,
  /\.render\(/i,
  /\.close\(/i
];

// Static scan across every source file in this module: no dynamic JSX/code
// construction primitive should ever appear here - this is a read-only
// contract/classification boundary, not an execution engine.
const ARBITRARY_EXECUTION_PATTERNS = [/\beval\s*\(/, /\bnew Function\s*\(/, /child_process/, /\bexec(File)?\s*\(/];

describe("ALLOWED_INSPECTION_QUERIES (read-only contract)", () => {
  it("is a non-empty, closed list", () => {
    expect(ALLOWED_INSPECTION_QUERIES.length).toBeGreaterThan(0);
  });

  it("never names a mutating/write AE API member", () => {
    for (const query of ALLOWED_INSPECTION_QUERIES) {
      for (const pattern of MUTATING_AE_API_PATTERNS) {
        expect(query.aeApiPath, `query "${query.id}" looks mutating: ${query.aeApiPath}`).not.toMatch(pattern);
      }
    }
  });

  it("has a unique id and a non-empty description for every entry", () => {
    const ids = ALLOWED_INSPECTION_QUERIES.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const query of ALLOWED_INSPECTION_QUERIES) {
      expect(query.description.length).toBeGreaterThan(0);
    }
  });
});

describe("inspection module (no arbitrary JSX/code-execution path)", () => {
  const sourceFiles = readdirSync(currentDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("scans every non-test source file in this module", () => {
    // Guards the test itself from silently scanning nothing if files move.
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  for (const file of sourceFiles) {
    it(`${file} contains no arbitrary code-execution primitive`, () => {
      const contents = readFileSync(join(currentDir, file), "utf8");
      for (const pattern of ARBITRARY_EXECUTION_PATTERNS) {
        expect(contents, `${file} matched forbidden pattern ${pattern}`).not.toMatch(pattern);
      }
    });
  }
});
