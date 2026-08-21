import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { ErrorResponse } from "@dyo/schemas";
import { AppError } from "./app-error.js";

/**
 * Single place that turns any thrown error into the API's public error
 * shape. Never leaks a stack trace or raw DB/process error message to the
 * client - see docs/engineering/API_STANDARDS.md.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      const body: ErrorResponse = {
        error: { code: error.code, message: error.message, requestId }
      };
      reply.status(error.statusCode).send(body);
      return;
    }

    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      const body: ErrorResponse = {
        error: { code: "VALIDATION_ERROR", message, requestId }
      };
      reply.status(400).send(body);
      return;
    }

    request.log.error({ err: error, requestId }, "unhandled error");
    const body: ErrorResponse = {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId
      }
    };
    reply.status(500).send(body);
  });
}
