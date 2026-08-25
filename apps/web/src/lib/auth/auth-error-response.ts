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
