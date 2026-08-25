import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type {
  AeStatus,
  JobErrorCode,
  JobStatus,
  McpStatus,
  UserRole,
  WorkerCapability,
  WorkerStatus
} from "@dyo/schemas";

const sqlEnumCheck = (column: string, values: readonly string[]): string =>
  `${column} in (${values.map((value) => `'${value}'`).join(", ")})`;

/**
 * DB status columns are constrained with a CHECK in addition to the
 * application-level Zod enum (docs/engineering/DATABASE.md: "Prefer DB
 * constraints plus application checks").
 *
 * These value lists are intentionally re-declared here rather than imported
 * at runtime from @dyo/schemas: drizzle-kit's schema loader transpiles this
 * file in isolation and cannot follow @dyo/schemas' own relative NodeNext
 * (".js") imports across package boundaries. Only *types* are imported above
 * (erased at compile time, so this doesn't affect drizzle-kit); these literal
 * arrays must stay in sync with packages/schemas/src/worker.ts and job.ts.
 */
export const DB_WORKER_STATUSES = ["ONLINE", "OFFLINE"] as const;
export const DB_AE_STATUSES = ["ONLINE", "OFFLINE", "UNKNOWN"] as const;
export const DB_MCP_STATUSES = ["ONLINE", "OFFLINE", "UNKNOWN"] as const;
export const DB_WORKER_CAPABILITIES = [
  "CHECK_HEALTH",
  "INSPECT_TEMPLATE",
  "VALIDATE_PLAN",
  "PREPARE_PROJECT",
  "EXECUTE_FRAME",
  "APPLY_BRANDING",
  "CREATE_PREVIEW",
  "CREATE_HORIZONTAL",
  "CREATE_REELS",
  "PREPARE_RENDER",
  "RENDER",
  "RESUME_JOB"
] as const;
export const DB_JOB_STATUSES = [
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "WAITING_FOR_ACTION",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED"
] as const;

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
    // References jobs.id (defined below) - a genuine circular FK between
    // these two tables. Drizzle's inline .references() accepts a callback
    // specifically so this forward reference works: the callback is only
    // ever invoked lazily (at introspection/migration time), by which point
    // the `jobs` export below has already been assigned.
    currentJobId: uuid("current_job_id").references((): AnyPgColumn => jobs.id, { onDelete: "set null" }),
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

/**
 * A job always belongs to exactly one worker, assigned at creation - not a
 * shared queue any worker can grab (CLAUDE.md's Windows worker connects
 * outbound only; the dispatch model here is "the worker asks for its own
 * next job", never the reverse). `operation` is constrained to
 * DB_WORKER_CAPABILITIES - never an arbitrary command string.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id, { onDelete: "cascade" }),
    operation: text("operation").notNull().$type<WorkerCapability>(),
    status: text("status").notNull().default("QUEUED").$type<JobStatus>(),
    payload: jsonb("payload").notNull(),
    result: jsonb("result"),
    error: jsonb("error").$type<{ code: JobErrorCode; message: string } | null>(),
    checkpoint: jsonb("checkpoint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  () => [
    check("jobs_operation_check", sql.raw(sqlEnumCheck("operation", DB_WORKER_CAPABILITIES))),
    check("jobs_status_check", sql.raw(sqlEnumCheck("status", DB_JOB_STATUSES)))
  ]
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;

export const DB_USER_ROLES = ["ADMIN", "OPERATOR"] as const;

/**
 * Dashboard operator accounts - a separate system from `workers` (Windows
 * worker token auth). Never stores a plaintext password, only a salted
 * scrypt hash - see apps/api/src/infrastructure/auth/password.ts.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("OPERATOR").$type<UserRole>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true })
  },
  () => [check("users_role_check", sql.raw(sqlEnumCheck("role", DB_USER_ROLES)))]
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/**
 * Server-side session record backing the dashboard's HttpOnly session
 * cookie. The cookie carries `${sessionId}.${secret}`; only a hash of
 * `secret` is ever stored (same scrypt pattern as worker token hashing,
 * kept as an intentionally separate implementation - CLAUDE.md: "Dashboard
 * user auth and Worker token auth are separate systems").
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
