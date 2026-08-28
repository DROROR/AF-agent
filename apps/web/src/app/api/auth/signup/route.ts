import { NextResponse } from "next/server";
import { signUpRequestSchema, userFacingAuthResponseSchema } from "@dyo/schemas";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { signUpRequest } from "../../../../lib/auth/auth-api-client";
import { signupDisabledResponse, toErrorResponse, validationErrorResponse } from "../../../../lib/auth/auth-error-response";
import { sessionCookieOptions, SESSION_COOKIE_NAME } from "../../../../lib/auth/session-cookie";
import { SIGNUP_ENABLED } from "../../../../lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * The only auth endpoint the browser ever calls for signup. Forwards to the
 * Fastify API over loopback, then strips sessionToken out of the JSON body
 * entirely - it only ever leaves this handler as an HttpOnly cookie, never
 * in a response a client script could read (CLAUDE.md: "no auth token
 * stored in localStorage").
 *
 * Login-only mode (see lib/feature-flags.ts): gated here too, not just on
 * the page - a direct POST (bypassing the UI entirely) must never create
 * an account while Signup is disabled.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!SIGNUP_ENABLED) {
    return signupDisabledResponse();
  }

  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = signUpRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.issues[0]?.message ?? "Invalid signup request");
  }

  try {
    const result = await signUpRequest(getApiBaseUrl(), parsed.data);
    const maxAgeSeconds = Math.max(1, Math.round((new Date(result.expiresAt).getTime() - Date.now()) / 1000));
    const response = NextResponse.json(userFacingAuthResponseSchema.parse({ user: result.user }), {
      status: 201
    });
    response.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, sessionCookieOptions(maxAgeSeconds));
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
