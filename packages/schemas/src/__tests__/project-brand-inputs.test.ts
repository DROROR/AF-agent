import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_INPUTS, parseHttpWebsiteUrl, projectBrandInputsSchema } from "../project.js";

/**
 * 2026-10-02: `websiteUrl` was added to an object that is already persisted
 * in a jsonb column, and is handed to a web-fetch tool. Two properties are
 * pinned here: every row written before the field existed must still parse,
 * and only a real public http(s) address is ever accepted.
 */
describe("projectBrandInputsSchema - websiteUrl", () => {
  const legacyRow = { logoAssetId: null, brandColors: [], textInstructions: null };

  it("still parses a row written before the field existed, defaulting it to null", () => {
    const parsed = projectBrandInputsSchema.parse(legacyRow);
    expect(parsed.websiteUrl).toBeNull();
  });

  it("accepts a real https address", () => {
    expect(projectBrandInputsSchema.parse({ ...legacyRow, websiteUrl: "https://example.com/app" }).websiteUrl).toBe("https://example.com/app");
  });

  it("accepts http as well as https", () => {
    expect(projectBrandInputsSchema.parse({ ...legacyRow, websiteUrl: "http://example.com" }).websiteUrl).toBe("http://example.com");
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    expect(projectBrandInputsSchema.parse({ ...legacyRow, websiteUrl: "  https://example.com  " }).websiteUrl).toBe("https://example.com");
  });

  it("reads an empty string as 'not given', never as an invalid URL", () => {
    expect(projectBrandInputsSchema.parse({ ...legacyRow, websiteUrl: "" }).websiteUrl).toBeNull();
  });

  it("refuses a scheme that is not http(s)", () => {
    for (const value of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "ftp://example.com"]) {
      expect(projectBrandInputsSchema.safeParse({ ...legacyRow, websiteUrl: value }).success).toBe(false);
    }
  });

  it("refuses an address that points at private infrastructure rather than a client's site", () => {
    for (const value of ["http://localhost", "http://localhost:4000/x", "http://127.0.0.1", "http://169.254.169.254/latest/meta-data/", "http://internal"]) {
      expect(projectBrandInputsSchema.safeParse({ ...legacyRow, websiteUrl: value }).success).toBe(false);
    }
  });

  it("refuses free text that is not a URL", () => {
    expect(projectBrandInputsSchema.safeParse({ ...legacyRow, websiteUrl: "our website" }).success).toBe(false);
  });

  it("still rejects an unknown field, so the object stays strict", () => {
    expect(projectBrandInputsSchema.safeParse({ ...legacyRow, websiteUrl: null, somethingElse: 1 }).success).toBe(false);
  });

  it("includes the field in the documented default, so a project with no brand inputs is still a complete object", () => {
    expect(DEFAULT_BRAND_INPUTS.websiteUrl).toBeNull();
    expect(projectBrandInputsSchema.safeParse(DEFAULT_BRAND_INPUTS).success).toBe(true);
  });
});

describe("parseHttpWebsiteUrl", () => {
  it("returns the parsed URL for a usable address", () => {
    expect(parseHttpWebsiteUrl("https://example.com/a")?.hostname).toBe("example.com");
  });

  it("returns null rather than throwing for anything unusable", () => {
    for (const value of ["", "   ", "not a url", "javascript:void(0)", "http://localhost"]) {
      expect(parseHttpWebsiteUrl(value)).toBeNull();
    }
  });
});
