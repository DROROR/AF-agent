import type { NewUserAiProviderConnection, UserAiProviderRecord, UserAiProviderRepository } from "../../../domain/user-ai-provider/types.js";

/** In-memory fake used only by unit tests - never imported from production code. Mirrors DrizzleUserAiProviderRepository's own semantics (one row per userId, upsert replaces). */
export class InMemoryUserAiProviderRepository implements UserAiProviderRepository {
  private readonly rowsByUserId = new Map<string, UserAiProviderRecord>();

  async findByUserId(userId: string): Promise<UserAiProviderRecord | null> {
    return this.rowsByUserId.get(userId) ?? null;
  }

  async upsert(connection: NewUserAiProviderConnection, now: Date): Promise<UserAiProviderRecord> {
    const existing = this.rowsByUserId.get(connection.userId);
    const row: UserAiProviderRecord = {
      id: existing?.id ?? connection.id,
      userId: connection.userId,
      provider: connection.provider,
      encryptedApiKey: connection.encryptedApiKey,
      last4: connection.last4,
      model: connection.model,
      lastVerifiedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.rowsByUserId.set(connection.userId, row);
    return row;
  }

  async markVerified(userId: string, now: Date): Promise<UserAiProviderRecord | null> {
    const existing = this.rowsByUserId.get(userId);
    if (!existing) {
      return null;
    }
    const updated: UserAiProviderRecord = { ...existing, lastVerifiedAt: now, updatedAt: now };
    this.rowsByUserId.set(userId, updated);
    return updated;
  }

  async deleteByUserId(userId: string): Promise<void> {
    this.rowsByUserId.delete(userId);
  }
}
