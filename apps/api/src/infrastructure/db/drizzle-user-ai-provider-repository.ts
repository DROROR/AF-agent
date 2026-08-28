import { eq } from "drizzle-orm";
import { userAiProviders, type Database, type UserAiProviderRow } from "@dyo/database";
import type { NewUserAiProviderConnection, UserAiProviderRecord, UserAiProviderRepository } from "../../domain/user-ai-provider/types.js";

function toDomain(row: UserAiProviderRow): UserAiProviderRecord {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    encryptedApiKey: row.encryptedApiKey,
    last4: row.last4,
    model: row.model,
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleUserAiProviderRepository implements UserAiProviderRepository {
  constructor(private readonly db: Database) {}

  async findByUserId(userId: string): Promise<UserAiProviderRecord | null> {
    const [row] = await this.db.select().from(userAiProviders).where(eq(userAiProviders.userId, userId));
    return row ? toDomain(row) : null;
  }

  async upsert(connection: NewUserAiProviderConnection, now: Date): Promise<UserAiProviderRecord> {
    const [row] = await this.db
      .insert(userAiProviders)
      .values({
        id: connection.id,
        userId: connection.userId,
        provider: connection.provider,
        encryptedApiKey: connection.encryptedApiKey,
        last4: connection.last4,
        model: connection.model,
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: userAiProviders.userId,
        set: {
          provider: connection.provider,
          encryptedApiKey: connection.encryptedApiKey,
          last4: connection.last4,
          model: connection.model,
          lastVerifiedAt: now,
          updatedAt: now
        }
      })
      .returning();
    if (!row) {
      throw new Error("insert into user_ai_providers returned no row");
    }
    return toDomain(row);
  }

  async markVerified(userId: string, now: Date): Promise<UserAiProviderRecord | null> {
    const [row] = await this.db
      .update(userAiProviders)
      .set({ lastVerifiedAt: now, updatedAt: now })
      .where(eq(userAiProviders.userId, userId))
      .returning();
    return row ? toDomain(row) : null;
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(userAiProviders).where(eq(userAiProviders.userId, userId));
  }
}
