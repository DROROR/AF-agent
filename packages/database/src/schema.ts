import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AeStatus, McpStatus, WorkerCapability, WorkerStatus } from "@dyo/schemas";

const sqlEnumCheck = (column: string, values: readonly string[]): string =>
  `${column} in (${values.map((value) => `'${value}'`).join(", ")})`;

/**
 * DB status columns are constrained with a CHECK in addition to the
 * application-level Zod enum (docs/engineering/DATABASE.md: "Prefer DB
 * constraints plus application checks"). currentJobId has no foreign key
 * yet - the jobs table does not exist until Phase 2.
 *
 * These value lists are intentionally re-declared here rather than imported
 * at runtime from @dyo/schemas: drizzle-kit's schema loader transpiles this
 * file in isolation and cannot follow @dyo/schemas' own relative NodeNext
 * (".js") imports across package boundaries. Only *types* are imported above
 * (erased at compile time, so this doesn't affect drizzle-kit); these two
 * literal arrays must stay in sync with packages/schemas/src/worker.ts's
 * WORKER_STATUSES/AE_STATUSES/MCP_STATUSES.
 */
export const DB_WORKER_STATUSES = ["ONLINE", "OFFLINE"] as const;
export const DB_AE_STATUSES = ["ONLINE", "OFFLINE", "UNKNOWN"] as const;
export const DB_MCP_STATUSES = ["ONLINE", "OFFLINE", "UNKNOWN"] as const;
export const workers = pgTable(
  "workers",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("OFFLINE").$type<WorkerStatus>(),
    aeStatus: text("ae_status").notNull().default("UNKNOWN").$type<AeStatus>(),
    mcpStatus: text("mcp_status").notNull().default("UNKNOWN").$type<McpStatus>(),
    aeVersion: text("ae_version"),
    capabilities: jsonb("capabilities")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<WorkerCapability[]>(),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    currentJobId: uuid("current_job_id"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("workers_status_check", sql.raw(sqlEnumCheck("status", DB_WORKER_STATUSES))),
    check("workers_ae_status_check", sql.raw(sqlEnumCheck("ae_status", DB_AE_STATUSES))),
    check("workers_mcp_status_check", sql.raw(sqlEnumCheck("mcp_status", DB_MCP_STATUSES))),
    check("workers_max_concurrency_check", sql`${table.maxConcurrency} > 0`)
  ]
);

export type WorkerRow = typeof workers.$inferSelect;
export type NewWorkerRow = typeof workers.$inferInsert;
