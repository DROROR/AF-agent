import { describe, expect, it } from "vitest";
import {
  DISPOSABLE_COPY_QUARANTINE_SUFFIX,
  hasAepExtension,
  inspectTemplateRequestSchema,
  isDisposableCopyPath,
  normalizeSourceProjectPath
} from "../inspect-template.js";

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

/**
 * REAL 2026-10-02 DEFECT. An earlier inspection's disposable copy was still
 * on disk (by design - the sweep that would remove it is reporting-only on
 * purpose), an operator pasted it in as the template source, every existing
 * check passed because it really is an existing .aep, and the worker made a
 * disposable copy OF the disposable copy. A project created from it would
 * have anchored its path and source hash to a file whose whole purpose is
 * to be thrown away.
 *
 * The worker already had this exact predicate, tested, and nothing in
 * production ever called it.
 */
describe("a disposable inspection copy is never a template source", () => {
  const REQUESTED = "C:\\DYO-Agent\\templates\\t5\\Android_App_Promo_CC2014+ (converted).dyo-inspect-ff9d115a-407c-4371-98e6-22dab787df51.aep";
  const REAL = "C:\\DYO-Agent\\templates\\t5\\Android_App_Promo_CC2014+ (converted).aep";

  it("recognises the exact path the failing run carried", () => {
    expect(isDisposableCopyPath(REQUESTED)).toBe(true);
  });

  it("does not mistake the real template for one", () => {
    expect(isDisposableCopyPath(REAL)).toBe(false);
  });

  it("recognises the copy-of-a-copy the worker went on to open", () => {
    expect(
      isDisposableCopyPath(
        "C:\\DYO-Agent\\templates\\t5\\Android_App_Promo_CC2014+ (converted).dyo-inspect-ff9d115a.dyo-inspect-3e43ee20.aep"
      )
    ).toBe(true);
  });

  it("rejects it through the request schema, with wording that says what to use instead", () => {
    const result = inspectTemplateRequestSchema.safeParse({ templateId: "t", sourceProjectPath: REQUESTED });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("temporary inspection copy");
      expect(result.error.issues[0]?.message).toContain(".dyo-inspect-");
    }
  });

  it("still accepts the real template through the same schema", () => {
    const result = inspectTemplateRequestSchema.safeParse({ templateId: "t", sourceProjectPath: REAL });
    expect(result.success).toBe(true);
  });

  it("judges the path AFTER the clipboard quotes are stripped, so a quoted copy is caught too", () => {
    expect(isDisposableCopyPath(`"${REQUESTED}"`)).toBe(true);
    const result = inspectTemplateRequestSchema.safeParse({ templateId: "t", sourceProjectPath: `"${REQUESTED}"` });
    expect(result.success).toBe(false);
  });

  it("matches the marker whatever case Windows reports it in", () => {
    expect(isDisposableCopyPath("C:\\x\\y.DYO-INSPECT-ABC.AEP")).toBe(true);
  });

  it("only ever looks at the last path segment, never at a parent folder's name", () => {
    expect(isDisposableCopyPath("C:\\.dyo-inspect-old\\real-template.aep")).toBe(false);
  });

  it("works for a POSIX-style path too, since this module is shared with the browser", () => {
    expect(isDisposableCopyPath("/templates/promo.dyo-inspect-abc.aep")).toBe(true);
    expect(isDisposableCopyPath("/templates/promo.aep")).toBe(false);
  });

  it("does not treat a QUARANTINED copy as a disposable one - it is inert, and the .aep rule reports it more clearly", () => {
    const quarantined = `${REQUESTED}${DISPOSABLE_COPY_QUARANTINE_SUFFIX}`;
    expect(isDisposableCopyPath(quarantined)).toBe(false);
    const result = inspectTemplateRequestSchema.safeParse({ templateId: "t", sourceProjectPath: quarantined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("ending in .aep");
    }
  });

  it("does not fire on a filename that merely mentions inspection", () => {
    expect(isDisposableCopyPath("C:\\x\\dyo inspect notes.aep")).toBe(false);
    expect(isDisposableCopyPath("C:\\x\\inspect-me.aep")).toBe(false);
  });
});
