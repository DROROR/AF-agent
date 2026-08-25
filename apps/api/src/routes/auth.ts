import type { FastifyInstance } from "fastify";
import { authSessionResponseSchema, logInRequestSchema, signUpRequestSchema, userDtoSchema } from "@dyo/schemas";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { extractBearerToken } from "../infrastructure/auth/bearer-token.js";
import { getDummyPasswordHash, hashPassword, verifyPassword } from "../infrastructure/auth/password.js";
import {
  generateSessionToken,
  hashSessionSecret,
  parseSessionCookieValue,
  verifySessionSecret
} from "../infrastructure/auth/session-token.js";
import { signUp } from "../application/auth/sign-up.js";
import { logIn } from "../application/auth/log-in.js";
import { logOut } from "../application/auth/log-out.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { DEFAULT_SESSION_TTL_MS } from "../application/auth/session-ttl.js";
import { toUserDto } from "../application/auth/user-dto-mapper.js";

export interface AuthRouteDeps {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

const LOGIN_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };
const SIGNUP_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

/**
 * Browser-facing shape only: {user, sessionToken, expiresAt} never crosses
 * this boundary as-is - the Next.js server-side route handlers that call
 * these endpoints strip sessionToken into an HttpOnly cookie and forward
 * only {user} to the browser (see CLAUDE.md's "no auth token stored in
 * localStorage" and apps/web's app/api/auth/* route handlers). This file
 * still validates its own response shape against authSessionResponseSchema
 * so that contract can't silently drift.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  app.post(
    "/api/auth/signup",
    { config: { rateLimit: SIGNUP_RATE_LIMIT } },
    async (request, reply) => {
      const body = signUpRequestSchema.parse(request.body);
      const result = await signUp(
        {
          userRepository: deps.userRepository,
          sessionRepository: deps.sessionRepository,
          hashPassword,
          generateSessionToken,
          hashSessionSecret,
          sessionTtlMs: DEFAULT_SESSION_TTL_MS,
          now
        },
        body
      );
      const response = authSessionResponseSchema.parse({
        user: toUserDto(result.user),
        sessionToken: result.cookieValue,
        expiresAt: result.expiresAt.toISOString()
      });
      reply.status(201).send(response);
    }
  );

  app.post(
    "/api/auth/login",
    { config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      const body = logInRequestSchema.parse(request.body);
      const result = await logIn(
        {
          userRepository: deps.userRepository,
          sessionRepository: deps.sessionRepository,
          verifyPassword,
          getDummyPasswordHash,
          generateSessionToken,
          hashSessionSecret,
          now
        },
        body
      );
      const response = authSessionResponseSchema.parse({
        user: toUserDto(result.user),
        sessionToken: result.cookieValue,
        expiresAt: result.expiresAt.toISOString()
      });
      reply.send(response);
    }
  );

  /** Idempotent by design: an already-invalid/expired/missing token still returns 204, never an error - logging out is always "safe to call". */
  app.post("/api/auth/logout", async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    const parsed = token ? parseSessionCookieValue(token) : null;
    if (parsed) {
      await logOut({ sessionRepository: deps.sessionRepository }, parsed.sessionId);
    }
    reply.status(204).send();
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    reply.send({ user: userDtoSchema.parse(toUserDto(user)) });
  });
}
