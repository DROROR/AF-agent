import type { UserAiProviderRepository } from "../../domain/user-ai-provider/types.js";
import { EncryptionNotConfiguredError, SecretDecryptionError, decryptSecret } from "../../infrastructure/crypto/secret-cipher.js";
import { AiProviderUnavailableError } from "../../errors/app-error.js";
import { NotConfiguredAiSuggestionProvider, type AiSuggestionProvider } from "./ai-suggestion-provider.js";
import { AnthropicSuggestionProvider } from "./anthropic-suggestion-provider.js";

export interface ResolveAiSuggestionProviderDeps {
  userAiProviderRepository: UserAiProviderRepository;
  credentialsEncryptionKey: string | undefined;
}

/**
 * BYOK section: Mapping Assistant uses the AUTHENTICATED user's own
 * connected provider, resolved fresh per request - never a single
 * app-wide instance (the old NotConfiguredAiSuggestionProvider singleton
 * this replaces as the injected dependency). Looking up by `userId` (the
 * caller's own session-authenticated id, never a caller-supplied one) is
 * what makes "one user must never access another user's provider
 * credentials" true by construction.
 *
 * Never throws for "not connected" - that is a normal, common state
 * (aiAvailable: false), not an error. A genuine decryption failure
 * (CREDENTIALS_ENCRYPTION_KEY missing/rotated, or a corrupted row) DOES
 * propagate - that is a real server misconfiguration, not something to
 * silently degrade past.
 */
export async function resolveAiSuggestionProviderForUser(deps: ResolveAiSuggestionProviderDeps, userId: string): Promise<AiSuggestionProvider> {
  const connection = await deps.userAiProviderRepository.findByUserId(userId);
  if (!connection) {
    return new NotConfiguredAiSuggestionProvider();
  }
  try {
    const apiKey = decryptSecret(connection.encryptedApiKey, deps.credentialsEncryptionKey ?? "");
    return new AnthropicSuggestionProvider(apiKey, connection.model);
  } catch (error) {
    // Never the generic catch-all 500 - this is always one of the two
    // typed failures above (see secret-cipher.ts), never something
    // requiring a raw stack trace to diagnose.
    if (error instanceof EncryptionNotConfiguredError) {
      throw new AiProviderUnavailableError("encryption is not configured on this server");
    }
    if (error instanceof SecretDecryptionError) {
      throw new AiProviderUnavailableError("the stored key could not be decrypted");
    }
    throw error;
  }
}
