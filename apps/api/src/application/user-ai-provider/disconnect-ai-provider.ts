import type { UserAiProviderRepository } from "../../domain/user-ai-provider/types.js";

export interface DisconnectAiProviderDeps {
  userAiProviderRepository: UserAiProviderRepository;
}

/** "Disconnect" - deletes the encrypted key outright, never merely hides it. Idempotent: disconnecting an already-disconnected user is a harmless no-op. */
export async function disconnectAiProvider(deps: DisconnectAiProviderDeps, userId: string): Promise<void> {
  await deps.userAiProviderRepository.deleteByUserId(userId);
}
