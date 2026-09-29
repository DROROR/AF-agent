import { describe, expect, it } from "vitest";
import { hasAepExtension, inspectTemplateRequestSchema, normalizeSourceProjectPath } from "../inspect-template.js";

/**
 * The real 2026-09-28 client failure these pin, end to end: Windows
 * Explorer's "Copy as path" produced a quoted path, the wizard's Inspect
 * button went quietly disabled, deleting only the closing quote enabled it
 * again, and the surviving opening quote made the dispatched path
 * non-absolute - so the worker joined it onto its work root and reported
 * ENOENT for a file that was plainly there.
 */
describe("source project path normalization", () => {
  const REAL_QUOTED_CLIPBOARD_PATH =
    '"C:\\DYO-Agent\\copy\\android-app-promo\\Android_App_Promo_CC2014+\\Android_App_Promo_CC2014+.aep"';
  const REAL_UNQUOTED_PATH =
    "C:\\DYO-Agent\\copy\\android-app-promo\\Android_App_Promo_CC2014+\\Android_App_Promo_CC2014+.aep";

  it("strips the double quotes Windows' own 'Copy as path' adds", () => {
    expect(normalizeSourceProjectPath(REAL_QUOTED_CLIPBOARD_PATH)).toBe(REAL_UNQUOTED_PATH);
  });

  it("strips a LONE opening quote - the exact string the failed client job carried", () => {
    // Left behind by deleting only the closing quote to get past the
    // disabled Inspect button. This is the one that reached the worker.
    expect(normalizeSourceProjectPath(`"${REAL_UNQUOTED_PATH}`)).toBe(REAL_UNQUOTED_PATH);
    expect(normalizeSourceProjectPath(`${REAL_UNQUOTED_PATH}"`)).toBe(REAL_UNQUOTED_PATH);
  });

  it("leaves an already-clean path exactly as it is", () => {
    expect(normalizeSourceProjectPath(REAL_UNQUOTED_PATH)).toBe(REAL_UNQUOTED_PATH);
  });

  it("trims surrounding whitespace, including a newline pasted with the path", () => {
    expect(normalizeSourceProjectPath(`  ${REAL_UNQUOTED_PATH}\n`)).toBe(REAL_UNQUOTED_PATH);
  });

  it("keeps a single quote that is part of the real filename - only a matched pair is removed", () => {
    // A single quote is legal in a Windows filename, so it is never assumed
    // to be clipboard packaging unless it wraps the whole path.
    expect(normalizeSourceProjectPath("C:\\work\\Dror's Promo.aep")).toBe("C:\\work\\Dror's Promo.aep");
    expect(normalizeSourceProjectPath("'C:\\work\\Promo.aep'")).toBe("C:\\work\\Promo.aep");
  });

  it("does not invent a path out of quotes alone", () => {
    expect(normalizeSourceProjectPath('""')).toBe("");
    expect(normalizeSourceProjectPath('   "  "  ')).toBe("");
  });
});

describe("hasAepExtension judges the normalized path", () => {
  it("accepts the quoted clipboard path the wizard used to leave disabled", () => {
    expect(hasAepExtension('"C:\\work\\Promo.aep"')).toBe(true);
  });

  it("still rejects a path that is not an .aep file at all", () => {
    expect(hasAepExtension('"C:\\work\\Promo"')).toBe(false);
    expect(hasAepExtension("C:\\work\\Promo.aepx")).toBe(false);
    expect(hasAepExtension("C:\\work")).toBe(false);
  });
});

describe("inspectTemplateRequestSchema", () => {
  it("dispatches the CLEANED path, so the worker never receives a quote", () => {
    const parsed = inspectTemplateRequestSchema.parse({
      templateId: "t1",
      sourceProjectPath: '"C:\\work\\Promo.aep"'
    });
    expect(parsed.sourceProjectPath).toBe("C:\\work\\Promo.aep");
  });

  it("rejects a path that is only quotes with the 'required' message, never an empty path", () => {
    const result = inspectTemplateRequestSchema.safeParse({ templateId: "t1", sourceProjectPath: '""' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Source project path is required");
    }
  });

  it("still rejects a directory path - the 2026-08-30 bug stays fixed", () => {
    const result = inspectTemplateRequestSchema.safeParse({
      templateId: "t1",
      sourceProjectPath: "C:\\work\\android-app-promo"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Source project path must be a file path ending in .aep");
    }
  });
});
