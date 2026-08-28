import { randomUUID } from "node:crypto";
import type { AiProviderStatus, ConnectAiProviderRequest } from "@dyo/schemas";
import { AiProviderConnectionFailedError } from "../../errors/app-error.js";
import type { UserAiProviderRepository } from "../../domain/user-ai-provider/types.js";
import { EncryptionNotConfiguredError, encryptSecret, last4 } from "../../infrastructure/crypto/secret-cipher.js";
import { testAnthropicConnection } from "./test-anthropic-connection.js";

export interface ConnectAiProviderDeps {
  userAiProviderRepository: UserAiProviderRepository;
  credentialsEncryptionKey: string | undefined;
  now: () => Date;
  testConnection?: (apiKey: string, model: string) => ReturnType<typeof testAnthropicConnection>;
}

/**
 * "Save & Connect" and "Replace Key" are the same real action - a user has
 * exactly one active connection at a time (schema.ts's own doc comment),
 * so setting a new key always replaces whatever was there before. ALWAYS
 * independently re-verifies the key/model with a real Anthropic call
 * first (test-anthropic-connection.ts) regardless of whether the browser
 * already called "Test Connection" separately - never trusts client-side
 * state, and never persists (encrypts/stores) a key that has not just
 * been proven to actually work.
 */
export async function connectAiProvider(deps: ConnectAiProviderDeps, userId: string, request: ConnectAiProviderRequest): Promise<AiProviderStatus> {
  const test = await (deps.testConnection ?? testAnthropicConnection)(request.apiKey, request.model);
  if (!test.ok) {
    throw new AiProviderConnectionFailedError(test.reason);
  }

  let encryptedApiKey: string;
  try {
    encryptedApiKey = encryptSecret(request.apiKey, deps.credentialsEncryptionKey ?? "");
  } catch (error) {
    // A real, actionable server misconfiguration (CREDENTIALS_ENCRYPTION_KEY
    // unset) - never let this fall through to the generic
    // "An unexpected error occurred" 500 (error-handler-plugin.ts's own
    // catch-all only recognizes AppError/ZodError), and never persist a
    // connection the server cannot actually encrypt.
    if (error instanceof EncryptionNotConfiguredError) {
      throw new AiProviderConnectionFailedError("Encryption is not configured on this server. Contact an administrator.");
    }
    throw error;
  }

  const now = deps.now();
  const record = await deps.userAiProviderRepository.upsert(
    {
      id: randomUUID(),
      userId,
      provider: request.provider,
      encryptedApiKey,
      last4: last4(request.apiKey),
      model: request.model
    },
    now
  );

  return {
    connected: true,
    provider: record.provider,
    model: record.model,
    last4: record.last4,
    lastVerifiedAt: record.lastVerifiedAt ? record.lastVerifiedAt.toISOString() : now.toISOString()
  };
}
