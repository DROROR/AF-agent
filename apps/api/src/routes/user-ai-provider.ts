import type { FastifyInstance } from "fastify";
import { connectAiProviderRequestSchema, testAiProviderConnectionResponseSchema } from "@dyo/schemas";
import type { UserAiProviderRepository } from "../domain/user-ai-provider/types.js";
import type { SessionRepository, UserRepository } from "../domain/auth/types.js";
import { verifySessionSecret } from "../infrastructure/auth/session-token.js";
import { requireSessionUser } from "../application/auth/require-session-user.js";
import { getAiProviderStatus } from "../application/user-ai-provider/get-ai-provider-status.js";
import { connectAiProvider } from "../application/user-ai-provider/connect-ai-provider.js";
import { disconnectAiProvider } from "../application/user-ai-provider/disconnect-ai-provider.js";
import { testAnthropicConnection } from "../application/user-ai-provider/test-anthropic-connection.js";

export interface UserAiProviderRouteDeps {
  userAiProviderRepository: UserAiProviderRepository;
  credentialsEncryptionKey: string | undefined;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  now?: () => Date;
}

/**
 * BYOK Settings routes - every route requires an authenticated dashboard
 * session and acts ONLY on `user.id` from that session (requireSessionUser's
 * own return value), never a caller-supplied user id anywhere in a param,
 * query, or body - this is what makes "one user must never access another
 * user's provider credentials" true by construction (domain/user-ai-provider/
 * types.ts's own doc comment). The raw API key is never returned in any
 * response here - GET only ever returns aiProviderStatusSchema's
 * connected/provider/model/last4/lastVerifiedAt shape.
 */
export function registerUserAiProviderRoutes(app: FastifyInstance, deps: UserAiProviderRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  const sessionDeps = {
    sessionRepository: deps.sessionRepository,
    userRepository: deps.userRepository,
    verifySessionSecret,
    now
  };

  app.get("/api/settings/ai-provider", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const status = await getAiProviderStatus({ userAiProviderRepository: deps.userAiProviderRepository }, user.id);
    reply.send({ status });
  });

  /** "Test Connection" - never persists anything, regardless of the outcome. */
  app.post("/api/settings/ai-provider/test", async (request, reply) => {
    await requireSessionUser(request.headers.authorization, sessionDeps);
    const body = connectAiProviderRequestSchema.parse(request.body);
    const result = await testAnthropicConnection(body.apiKey, body.model);
    reply.send(testAiProviderConnectionResponseSchema.parse({ ok: result.ok, reason: result.ok ? null : result.reason }));
  });

  /** "Save & Connect" and "Replace Key" - the same real action (see connect-ai-provider.ts's own doc comment). */
  app.post("/api/settings/ai-provider", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    const body = connectAiProviderRequestSchema.parse(request.body);
    const status = await connectAiProvider(
      { userAiProviderRepository: deps.userAiProviderRepository, credentialsEncryptionKey: deps.credentialsEncryptionKey, now },
      user.id,
      body
    );
    reply.status(201).send({ status });
  });

  app.delete("/api/settings/ai-provider", async (request, reply) => {
    const user = await requireSessionUser(request.headers.authorization, sessionDeps);
    await disconnectAiProvider({ userAiProviderRepository: deps.userAiProviderRepository }, user.id);
    reply.status(204).send();
  });
}
