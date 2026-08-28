import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ErrorResponse } from "@dyo/schemas";
import { AuthApiRequestError } from "./auth-api-client";

/** Shared by the signup and login route handlers so a failure from the Fastify API (409 duplicate email, 401 bad credentials, 429 rate limit, ...) reaches the browser with its real status/code/message intact. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthApiRequestError) {
    const body: ErrorResponse = {
      error: { code: error.code, message: error.message, requestId: randomUUID() }
    };
    return NextResponse.json(body, { status: error.status });
  }
  const body: ErrorResponse = {
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId: randomUUID() }
  };
  return NextResponse.json(body, { status: 500 });
}

export function validationErrorResponse(message: string): NextResponse {
  const body: ErrorResponse = { error: { code: "VALIDATION_ERROR", message, requestId: randomUUID() } };
  return NextResponse.json(body, { status: 400 });
}

/**
 * Login-only mode (see lib/feature-flags.ts) - a purely web-app-local
 * refusal that never reaches the Fastify API at all, so "SIGNUP_DISABLED"
 * is deliberately not part of @dyo/schemas' own ErrorCode enum (that
 * enum is for errors the API itself can return - see its own doc
 * comment). Shaped the same as every other auth error response anyway
 * (error.code/message/requestId) since translateServerErrorCode reads
 * `code` as a loose string, not the strict enum type.
 */
export function signupDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: "SIGNUP_DISABLED", message: "Signup is temporarily disabled", requestId: randomUUID() } },
    { status: 403 }
  );
}
