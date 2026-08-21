import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { schema, type Database } from "@dyo/database";

const currentDir = dirname(fileURLToPath(import.meta.url));
// packages/database's committed migrations - the same SQL a real Postgres
// deployment applies, replayed here against an embedded engine so this test
// exercises real migrations/constraints instead of a mock.
const migrationsFolder = join(currentDir, "..", "..", "..", "..", "packages", "database", "migrations");

/**
 * This sandbox has no Docker/Postgres available (see docs/AUDIT.md). PGlite
 * is a real embedded Postgres (WASM), not a mock, so migrations/constraints/
 * transactions are genuinely exercised - see docs/engineering/TESTING.md
 * ("mock external process boundaries, not internal business logic"; the
 * database is internal business logic's dependency, not a process boundary).
 * Production still runs on real PostgreSQL via @dyo/database's node-postgres
 * client - this is test-only wiring.
 */
export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder });
  return { db, close: () => client.close() };
}
