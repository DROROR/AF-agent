import { createDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL is required to run migrations");
  process.exit(1);
}

const { db, pool } = createDatabase(connectionString);

runMigrations(db)
  .then(() => {
    console.log("Migrations applied successfully");
  })
  .catch((error: unknown) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
