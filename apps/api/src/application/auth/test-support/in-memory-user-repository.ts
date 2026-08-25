import { DuplicateEmailError, type NewUser, type User, type UserRepository } from "../../../domain/auth/types.js";

/** In-memory fake used only by unit tests - never imported from production code. */
export class InMemoryUserRepository implements UserRepository {
  private readonly rows = new Map<string, User>();

  async create(user: NewUser, now: Date): Promise<User> {
    const existing = [...this.rows.values()].find((row) => row.email === user.email);
    if (existing) {
      throw new DuplicateEmailError(user.email);
    }
    const row: User = {
      id: user.id,
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
      role: "OPERATOR",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findByEmail(normalizedEmail: string): Promise<User | null> {
    return [...this.rows.values()].find((row) => row.email === normalizedEmail) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.rows.get(id) ?? null;
  }

  async updateLastLoginAt(id: string, now: Date): Promise<void> {
    const existing = this.rows.get(id);
    if (existing) {
      this.rows.set(id, { ...existing, lastLoginAt: now, updatedAt: now });
    }
  }
}
