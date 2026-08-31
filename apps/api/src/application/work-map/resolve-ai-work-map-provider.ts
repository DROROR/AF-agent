import type { UserAiProviderRepository } from "../../domain/user-ai-provider/types.js";
import { EncryptionNotConfiguredError, SecretDecryptionError, decryptSecret } from "../../infrastructure/crypto/secret-cipher.js";
import { AiProviderUnavailableError } from "../../errors/app-error.js";
import { NotConfiguredAiWorkMapProvider, type AiWorkMapProvider } from "./ai-work-map-provider.js";
import { AnthropicWorkMapDraftProvider } from "./anthropic-work-map-draft-provider.js";

export interface ResolveAiWorkMapProviderDeps {
  userAiProviderRepository: UserAiProviderRepository;
  credentialsEncryptionKey: string | undefined;
}

/**
 * Same BYOK resolution as resolve-ai-suggestion-provider.ts - the
 * AUTHENTICATED user's own connected provider, resolved fresh per
 * request, never a shared app-wide credential. Kept as its own function
 * (rather than reusing resolveAiSuggestionProviderForUser) because it
 * returns a different provider interface (AiWorkMapProvider, not
 * AiSuggestionProvider) - the two AI capabilities are deliberately not
 * conflated into one seam, even though they share the same underlying
 * BYOK key/decrypt logic.
 */
export async function resolveAiWorkMapProviderForUser(deps: ResolveAiWorkMapProviderDeps, userId: string): Promise<AiWorkMapProvider> {
  const connection = await deps.userAiProviderRepository.findByUserId(userId);
  if (!connection) {
    return new NotConfiguredAiWorkMapProvider();
  }
  try {
    const apiKey = decryptSecret(connection.encryptedApiKey, deps.credentialsEncryptionKey ?? "");
    return new AnthropicWorkMapDraftProvider(apiKey, connection.model);
  } catch (error) {
    if (error instanceof EncryptionNotConfiguredError) {
      throw new AiProviderUnavailableError("encryption is not configured on this server");
    }
    if (error instanceof SecretDecryptionError) {
      throw new AiProviderUnavailableError("the stored key could not be decrypted");
    }
    throw error;
  }
}
