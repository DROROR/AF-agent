import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api-base-url";
import { logOutRequest } from "../../../../lib/auth/auth-api-client";
import { CLEARED_SESSION_COOKIE_OPTIONS, SESSION_COOKIE_NAME } from "../../../../lib/auth/session-cookie";

export const dynamic = "force-dynamic";

/** Always clears the browser's cookie, even if the API call fails or there was no session to begin with - logout must never get "stuck". */
export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (sessionToken) {
    await logOutRequest(getApiBaseUrl(), sessionToken);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", CLEARED_SESSION_COOKIE_OPTIONS);
  return response;
}
