import { describe, expect, it } from "vitest";
import { decideRouteGuard, isAuthRoute } from "./route-guard";

describe("isAuthRoute", () => {
  it("treats /login and /signup as auth routes", () => {
    expect(isAuthRoute("/login")).toBe(true);
    expect(isAuthRoute("/signup")).toBe(true);
  });

  it("treats every dashboard route as not an auth route", () => {
    expect(isAuthRoute("/")).toBe(false);
    expect(isAuthRoute("/projects")).toBe(false);
    expect(isAuthRoute("/workers")).toBe(false);
    expect(isAuthRoute("/settings")).toBe(false);
  });
});

describe("decideRouteGuard", () => {
  it("redirects an unauthenticated visitor away from a protected route (protected route redirect)", () => {
    expect(decideRouteGuard("/", false)).toBe("redirect-to-login");
    expect(decideRouteGuard("/projects", false)).toBe("redirect-to-login");
    expect(decideRouteGuard("/workers", false)).toBe("redirect-to-login");
  });

  it("allows an authenticated visitor onto a protected route (authenticated route access)", () => {
    expect(decideRouteGuard("/", true)).toBe("allow");
    expect(decideRouteGuard("/projects", true)).toBe("allow");
    expect(decideRouteGuard("/settings", true)).toBe("allow");
  });

  it("allows an unauthenticated visitor onto /login or /signup", () => {
    expect(decideRouteGuard("/login", false)).toBe("allow");
    expect(decideRouteGuard("/signup", false)).toBe("allow");
  });

  it("redirects an already-authenticated visitor away from /login or /signup", () => {
    expect(decideRouteGuard("/login", true)).toBe("redirect-to-dashboard");
    expect(decideRouteGuard("/signup", true)).toBe("redirect-to-dashboard");
  });
});
