import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

/**
 * Real production bug, 2026-08-30: Next.js's own default 10MB request-body
 * buffer (used to let middleware.ts and the route handler both read a
 * request body) silently truncated multipart asset uploads over 10MB
 * before dyo-api ever saw them - confirmed via Next's own logged warning
 * lining up exactly with dyo-api's "Part terminated early" 500s. This
 * proves the fix (raising that cap) is actually configured and that the
 * pre-existing turbopack config was never clobbered while adding it.
 */
describe("next.config.ts - proxy body size fix", () => {
  it("raises the proxy/middleware body buffer cap to 210mb, matching nginx's own client_max_body_size", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe("210mb");
  });

  it("never widens this to unbounded - it stays a real, bounded string value", () => {
    expect(typeof nextConfig.experimental?.proxyClientMaxBodySize).toBe("string");
  });

  it("preserves the pre-existing turbopack @dyo/schemas resolveAlias - adding experimental never clobbered it", () => {
    expect(nextConfig.turbopack?.resolveAlias).toMatchObject({ "@dyo/schemas": "../../packages/schemas/dist/index.js" });
  });

  it("keeps reactStrictMode on - unrelated existing config is untouched", () => {
    expect(nextConfig.reactStrictMode).toBe(true);
  });
});
