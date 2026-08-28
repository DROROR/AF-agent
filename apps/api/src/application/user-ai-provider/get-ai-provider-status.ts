import type { AiProviderStatus } from "@dyo/schemas";
import type { UserAiProviderRepository } from "../../domain/user-ai-provider/types.js";

export interface GetAiProviderStatusDeps {
  userAiProviderRepository: UserAiProviderRepository;
}

/** Settings -> AI Provider's own "Connection status" - never the key itself, only `last4` (see aiProviderStatusSchema's own doc comment). */
export async function getAiProviderStatus(deps: GetAiProviderStatusDeps, userId: string): Promise<AiProviderStatus> {
  const connection = await deps.userAiProviderRepository.findByUserId(userId);
  if (!connection) {
    return { connected: false, provider: null, model: null, last4: null, lastVerifiedAt: null };
  }
  return {
    connected: true,
    provider: connection.provider,
    model: connection.model,
    last4: connection.last4,
    lastVerifiedAt: connection.lastVerifiedAt ? connection.lastVerifiedAt.toISOString() : null
  };
}
