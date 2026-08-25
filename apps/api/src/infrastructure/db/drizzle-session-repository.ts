import { eq } from "drizzle-orm";
import { sessions, type Database, type SessionRow } from "@dyo/database";
import type { NewSession, Session, SessionRepository } from "../../domain/auth/types.js";

function toDomain(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt
  };
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async create(session: NewSession): Promise<Session> {
    const [row] = await this.db
      .insert(sessions)
      .values({
        id: session.id,
        userId: session.userId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt
      })
      .returning();
    if (!row) {
      throw new Error("insert into sessions returned no row");
    }
    return toDomain(row);
  }

  async findById(id: string): Promise<Session | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id));
    return row ? toDomain(row) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }
}
