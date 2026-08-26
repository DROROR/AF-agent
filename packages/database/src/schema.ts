import { sql } from "drizzle-orm";
import { check, doublePrecision, integer, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type {
  AeStatus,
  JobErrorCode,
  JobStatus,
  McpStatus,
  MediaKind,
  PlanStatus,
  ProjectBrandInputs,
  ScenePlanEntry,
  TemplateManifest,
  UserRole,
  WorkerCapability,
  WorkerStatus,
  WorkMapEntry
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
  "INSPECT_SCENE_EVIDENCE",
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

export const DB_PLAN_STATUSES = ["DRAFT", "APPROVED", "REJECTED"] as const;
export const DB_MEDIA_KINDS = ["IMAGE", "VIDEO", "LOGO", "AUDIO", "DOCUMENT", "OTHER"] as const;

/**
 * The durable anchor for "one project" (Phase 4 / docs/PHASES.md section
 * 9) - a validated TemplateManifest a dashboard operator has chosen to
 * plan against. Before this table, a manifest only ever lived transiently
 * in a job's own result column.
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  templateId: text("template_id").notNull(),
  sourceProjectSha256: text("source_project_sha256").notNull(),
  manifest: jsonb("manifest").notNull().$type<TemplateManifest>(),
  /** Client's own brand inputs (logo asset reference, colors, text instructions) - null for a project that hasn't set any yet; the application layer maps null to DEFAULT_BRAND_INPUTS rather than requiring a DB-level jsonb default. Never DYO's own permanent brand rules (see project.ts's own doc comment). */
  brandInputs: jsonb("brand_inputs").$type<ProjectBrandInputs>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

/**
 * Append-only: a content edit always INSERTs a new row (revision + 1),
 * never UPDATEs one - this is the plan's full revision history for free,
 * with no separate history table (Phase 4 section 9: "historical
 * revisions if feasible with current schema"). approve/reject/reopen are
 * the only in-place UPDATEs, since they change status without changing
 * content, so incrementing revision for them would be misleading. The
 * unique (project_id, revision) constraint is the hard backstop against a
 * concurrent-edit race double-inserting the same next revision (defense
 * in depth alongside the application-layer baseRevision check).
 */
export const executionPlans = pgTable(
  "execution_plans",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    status: text("status").notNull().default("DRAFT").$type<PlanStatus>(),
    templateId: text("template_id").notNull(),
    /** Copied from the owning project at plan-creation time, not re-joined live - CLAUDE.md Safety Rule 8 / Phase 4: a plan is bound to the EXACT source revision it was built for, even if the project's own manifest is later replaced. */
    sourceProjectSha256: text("source_project_sha256").notNull(),
    scenePlans: jsonb("scene_plans").notNull().$type<ScenePlanEntry[]>(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("execution_plans_status_check", sql.raw(sqlEnumCheck("status", DB_PLAN_STATUSES))),
    check("execution_plans_revision_check", sql`${table.revision} > 0`),
    unique("execution_plans_project_revision_unique").on(table.projectId, table.revision)
  ]
);

export type ExecutionPlanRow = typeof executionPlans.$inferSelect;
export type NewExecutionPlanRow = typeof executionPlans.$inferInsert;

/**
 * Real Asset Catalog (asset-workmap-intake phase). `storageKey` is an
 * opaque, server-generated identifier into AssetStorage - never the
 * original filename, never a filesystem path exposed to the browser.
 * `sha256`/`byteSize` are always computed server-side from the actual
 * written bytes, never trusted from the client. Deleting a project
 * cascades to its assets (their storage files must be cleaned up by the
 * application layer BEFORE the DB delete, since a DB cascade cannot also
 * delete a file on disk - see delete-asset.ts).
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    storageKey: text("storage_key").notNull(),
    mediaKind: text("media_kind").notNull().$type<MediaKind>(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: doublePrecision("duration_seconds"),
    label: text("label"),
    notes: text("notes"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("assets_media_kind_check", sql.raw(sqlEnumCheck("media_kind", DB_MEDIA_KINDS))),
    check("assets_byte_size_check", sql`${table.byteSize} >= 0`),
    unique("assets_storage_key_unique").on(table.storageKey)
  ]
);
export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;

/**
 * Work Map - real, structured client/user INTENT for a project (never a
 * machine-observed source fact - see work-map.ts's own doc comment).
 * Append-only per content edit, same pattern as execution_plans: a PUT
 * always inserts a new revision, optimistic-concurrency-checked via
 * baseRevision at the application layer, backstopped here by the unique
 * (project_id, revision) constraint.
 */
export const projectWorkMaps = pgTable(
  "project_work_maps",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    entries: jsonb("entries").notNull().$type<WorkMapEntry[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("project_work_maps_revision_check", sql`${table.revision} > 0`),
    unique("project_work_maps_project_revision_unique").on(table.projectId, table.revision)
  ]
);
export type ProjectWorkMapRow = typeof projectWorkMaps.$inferSelect;
export type NewProjectWorkMapRow = typeof projectWorkMaps.$inferInsert;
