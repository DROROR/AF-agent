export type RouteGuardDecision = "allow" | "redirect-to-login" | "redirect-to-dashboard";

const AUTH_ROUTES = new Set(["/login", "/signup"]);

/** Every route apart from /login and /signup is part of the protected dashboard - a new page added later is protected by default, not by opting in. */
export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.has(pathname);
}

/**
 * Pure decision function behind middleware.ts - kept separate and testable
 * without needing a real Next.js request/response. CLAUDE.md: unauthenticated
 * users must be redirected to /login; logged-in users visiting /login or
 * /signup must be redirected to the dashboard.
 */
export function decideRouteGuard(pathname: string, isAuthenticated: boolean): RouteGuardDecision {
  const onAuthRoute = isAuthRoute(pathname);

  if (!isAuthenticated && !onAuthRoute) {
    return "redirect-to-login";
  }
  if (isAuthenticated && onAuthRoute) {
    return "redirect-to-dashboard";
  }
  return "allow";
}
