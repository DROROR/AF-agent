import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "./lib/api-base-url";
import { fetchCurrentUser } from "./lib/auth/auth-api-client";
import { decideRouteGuard } from "./lib/auth/route-guard";
import { SESSION_COOKIE_NAME } from "./lib/auth/session-cookie";

// Nodejs runtime (not the default Edge runtime) so this behaves exactly
// like every other server-side call in this app - a plain loopback fetch()
// to the Fastify API, same as apps/web/src/lib/fetch-dashboard-status.ts.
export const runtime = "nodejs";

/**
 * The single, authoritative route guard - every request re-validates the
 * session against the real sessions table (apps/api's GET /api/auth/me),
 * never trusting the cookie's mere presence. CLAUDE.md: unauthenticated
 * users must be redirected to /login; logged-in users visiting /login or
 * /signup must be redirected to the dashboard. See lib/auth/route-guard.ts
 * for the (separately unit-tested) decision logic this wraps.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = sessionToken
    ? (await fetchCurrentUser(getApiBaseUrl(), sessionToken)) !== null
    : false;

  const decision = decideRouteGuard(request.nextUrl.pathname, isAuthenticated);

  if (decision === "redirect-to-login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (decision === "redirect-to-dashboard") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Skips built assets, the favicon, the brand logo files, and the auth API
  // routes themselves - POST /api/auth/login must stay reachable while
  // unauthenticated, since logging in is exactly what it's for.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|api/auth/).*)"]
};
