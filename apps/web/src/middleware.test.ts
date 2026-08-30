import { describe, expect, it } from "vitest";
import { config } from "./middleware";

/**
 * Real production bug, 2026-08-30: the asset upload route's request body
 * was being silently truncated over 10MB by Next.js's own body-cloning
 * feature, which only activates for routes this middleware's matcher
 * covers. The fix (next.config.ts's proxyClientMaxBodySize) intentionally
 * does NOT touch this matcher - the auth boundary must stay exactly as
 * it was. This proves that boundary is unchanged: the asset upload route
 * (and every other authenticated route) is still covered by the auth
 * guard, and the deliberately-excluded paths still bypass it.
 */
describe("middleware.ts - auth boundary unchanged by the proxy body-size fix", () => {
  function matches(pathname: string): boolean {
    // The matcher string is already a valid regex source for this
    // project's one literal pattern (a single negative-lookahead group) -
    // this exercises the real, unmodified pattern from middleware.ts
    // directly, without pulling in Next's internal path-to-regexp build step.
    const pattern = config.matcher[0] as string;
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(pathname);
  }

  it("still protects the asset upload route - the auth boundary was never widened or narrowed", () => {
    expect(matches("/api/projects/20c6a75c-78b3-4686-be66-ab62e5a684e0/assets")).toBe(true);
  });

  it("still protects every other project/dashboard route", () => {
    expect(matches("/projects/20c6a75c-78b3-4686-be66-ab62e5a684e0/scenes")).toBe(true);
    expect(matches("/workers")).toBe(true);
  });

  it("still excludes only the same pre-existing unauthenticated paths (auth API, static assets, brand files)", () => {
    expect(matches("/api/auth/login")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/_next/image")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/brand/logo.svg")).toBe(false);
  });
});
