import { cookies } from "next/headers";
import type { UserDto } from "@dyo/schemas";
import { getApiBaseUrl } from "../api-base-url";
import { fetchCurrentUser } from "./auth-api-client";
import { SESSION_COOKIE_NAME } from "./session-cookie";

/** Server Components/layouts only (uses next/headers' cookies(), which throws if imported from client code) - reads the HttpOnly session cookie directly. */
export async function getCurrentUser(): Promise<UserDto | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return null;
  }
  return fetchCurrentUser(getApiBaseUrl(), sessionToken);
}
