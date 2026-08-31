import { describe, expect, it } from "vitest";
import { safeContentDispositionFilename } from "../worker-asset-download.js";

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
