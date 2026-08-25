import { eq } from "drizzle-orm";
import { users, type Database, type UserRow } from "@dyo/database";
import { DuplicateEmailError, type NewUser, type User, type UserRepository } from "../../domain/auth/types.js";

const UNIQUE_VIOLATION = "23505";

function toDomain(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt
  };
}

/** Postgres reports a unique-constraint violation with SQLSTATE 23505 - narrower than checking error.message text. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === UNIQUE_VIOLATION;
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async create(user: NewUser, now: Date): Promise<User> {
    try {
      const [row] = await this.db
        .insert(users)
        .values({
          id: user.id,
          name: user.name,
          email: user.email,
          passwordHash: user.passwordHash,
          role: "OPERATOR",
          createdAt: now,
          updatedAt: now,
          lastLoginAt: null
        })
        .returning();
      if (!row) {
        throw new Error("insert into users returned no row");
      }
      return toDomain(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateEmailError(user.email);
      }
      throw error;
    }
  }

  async findByEmail(normalizedEmail: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, normalizedEmail));
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ? toDomain(row) : null;
  }

  async updateLastLoginAt(id: string, now: Date): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, id));
  }
}
