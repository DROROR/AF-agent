import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Database } from "./client.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(currentDir, "..", "migrations");

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
