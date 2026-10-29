import { describe, expect, it } from "vitest";
import { contentDispositionAttachment, safeContentDispositionFilename } from "../worker-asset-download.js";

/**
 * Client-handoff phase, section AA (security review) - originalFilename is
 * the browser-uploaded filename verbatim, never sanitized at upload time
 * (routes/assets.ts's own multipart handling), so this is the ONLY thing
 * standing between a malicious upload and a broken/injected
 * Content-Disposition header on the worker-facing download route.
 */
describe("safeContentDispositionFilename", () => {
  it("leaves an ordinary filename unchanged", () => {
    expect(safeContentDispositionFilename("hero.jpg")).toBe("hero.jpg");
  });

  it("escapes a double quote so it can never close the quoted value early", () => {
    expect(safeContentDispositionFilename('evil".jpg')).toBe('evil\\".jpg');
  });

  it("escapes a literal backslash before escaping quotes, so the escaping itself can't be broken out of", () => {
    expect(safeContentDispositionFilename("evil\\.jpg")).toBe("evil\\\\.jpg");
    expect(safeContentDispositionFilename('evil\\".jpg')).toBe('evil\\\\\\".jpg');
  });

  it("strips CR/LF - Node's own header validation already rejects raw CR/LF, but a malicious filename must never break the endpoint for every future download of that asset", () => {
    expect(safeContentDispositionFilename("evil\r\nX-Injected: 1.jpg")).toBe("evilX-Injected: 1.jpg");
  });

  it("strips other C0 control characters and DEL", () => {
    expect(safeContentDispositionFilename("evil\x00\x1f\x7f.jpg")).toBe("evil.jpg");
  });
});

describe("contentDispositionAttachment", () => {
  it("an ASCII filename is sent as the plain quoted form only", () => {
    expect(contentDispositionAttachment("hero.jpg")).toBe('attachment; filename="hero.jpg"');
  });

  it("REAL 2026-10-29: a Hebrew filename never reaches the header raw (Node rejects it with ERR_INVALID_CHAR and the download answered 500) - ASCII fallback plus RFC 5987 filename*", () => {
    const value = contentDispositionAttachment("מסך 5.png");
    expect(value).toBe(`attachment; filename="___ 5.png"; filename*=UTF-8''${encodeURIComponent("מסך 5.png")}`);
    // Every character is one Node accepts in a header value.
    expect(/^[\x20-\x7e]+$/.test(value)).toBe(true);
  });

  it("still escapes quotes in the fallback so the quoted value cannot be closed early", () => {
    expect(contentDispositionAttachment('evil".jpg')).toBe('attachment; filename="evil\\".jpg"');
  });
});
