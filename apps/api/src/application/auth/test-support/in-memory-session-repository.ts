import type { NewSession, Session, SessionRepository } from "../../../domain/auth/types.js";

/** In-memory fake used only by unit tests - never imported from production code. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly rows = new Map<string, Session>();

  async create(session: NewSession): Promise<Session> {
    const row: Session = { ...session, createdAt: new Date() };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<Session | null> {
    return this.rows.get(id) ?? null;
  }

  async deleteById(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
