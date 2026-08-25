import { NextResponse } from "next/server";
import { logInRequestSchema, userFacingAuthResponseSchema } from "@dyo/schemas";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { logInRequest } from "../../../../lib/auth/auth-api-client";
import { toErrorResponse, validationErrorResponse } from "../../../../lib/auth/auth-error-response";
import { sessionCookieOptions, SESSION_COOKIE_NAME } from "../../../../lib/auth/session-cookie";

export const dynamic = "force-dynamic";

/**
 * The only auth endpoint the browser ever calls for login - see
 * app/api/auth/signup/route.ts's comment for why sessionToken never reaches
 * the response body. "Remember me" unchecked issues a browser-session
 * cookie (no maxAge, cleared on browser close); checked issues a
 * persistent cookie matching the API's own longer session TTL.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = logInRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.issues[0]?.message ?? "Invalid login request");
  }

  try {
    const result = await logInRequest(getApiBaseUrl(), parsed.data);
    const response = NextResponse.json(userFacingAuthResponseSchema.parse({ user: result.user }), {
      status: 200
    });
    const cookieOptions = parsed.data.rememberMe
      ? sessionCookieOptions(Math.max(1, Math.round((new Date(result.expiresAt).getTime() - Date.now()) / 1000)))
      : sessionCookieOptions();
    response.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, cookieOptions);
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
