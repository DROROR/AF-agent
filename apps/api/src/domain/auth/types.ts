import type { UserRole } from "@dyo/schemas";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface NewUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

/** Thrown by UserRepository.create() when the email unique constraint is violated - including a race lost to app-level pre-checking. */
export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} already exists`);
    this.name = "DuplicateEmailError";
  }
}

/**
 * Port the application layer depends on. Implemented by
 * infrastructure/db/drizzle-user-repository.ts in production and an
 * in-memory fake in unit tests - same dependency direction as
 * domain/worker/types.ts's WorkerRepository.
 */
export interface UserRepository {
  create(user: NewUser, now: Date): Promise<User>;
  findByEmail(normalizedEmail: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  updateLastLoginAt(id: string, now: Date): Promise<void>;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface NewSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionRepository {
  create(session: NewSession): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  deleteById(id: string): Promise<void>;
}
