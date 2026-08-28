export const AI_PROVIDER_NAMES = ["ANTHROPIC"] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

export interface UserAiProviderRecord {
  id: string;
  userId: string;
  provider: AiProviderName;
  /** AES-256-GCM ciphertext (see infrastructure/crypto/secret-cipher.ts) - never the plaintext key. */
  encryptedApiKey: string;
  last4: string;
  model: string;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewUserAiProviderConnection {
  id: string;
  userId: string;
  provider: AiProviderName;
  encryptedApiKey: string;
  last4: string;
  model: string;
}

/**
 * Port the application layer depends on. Every method is scoped to a
 * single `userId` the caller already authenticated (see
 * require-session-user.ts) - there is no method that reads or writes by
 * any other user's id, so "one user must never access another user's
 * provider credentials" is true by construction, not by a permission
 * check someone could forget to add.
 */
export interface UserAiProviderRepository {
  findByUserId(userId: string): Promise<UserAiProviderRecord | null>;
  /** Replaces any existing connection for this user (Save & Connect / Replace Key are the same real action - a user has exactly one active connection at a time). */
  upsert(connection: NewUserAiProviderConnection, now: Date): Promise<UserAiProviderRecord>;
  /** Marks a successful connection test/use without changing the stored key - "Connection status" reflects this. */
  markVerified(userId: string, now: Date): Promise<UserAiProviderRecord | null>;
  /** Disconnect - never leaves a stale encrypted key behind. */
  deleteByUserId(userId: string): Promise<void>;
}
