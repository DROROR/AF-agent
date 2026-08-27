import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, integer, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type {
  AeStatus,
  EvidenceRef,
  ExecutionSessionStatus,
  JobErrorCode,
  JobStatus,
  McpStatus,
  MediaKind,
  PlaceholderType,
  PlanStatus,
  ProjectBrandInputs,
  RenderArtifactValidationStatus,
  RenderOutputs,
  RenderOutputVariant,
  SceneEvidenceResponse,
  ScenePlanEntry,
  SuggestionSource,
  SuggestionStatus,
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
  "INSPECT_RENDER_CAPABILITIES",
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
export const DB_EXECUTION_SESSION_STATUSES = [
  "PREPARING",
  "EDITING",
  "AWAITING_PREVIEW_APPROVAL",
  "READY_TO_RENDER",
  "RENDERING",
  "COMPLETED",
  "PAUSED",
  "FAILED"
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
    /** Null for operations not bound to a project (e.g. CHECK_HEALTH) - see job-dispatch.ts. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
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
    /** Explicit, independent-per-variant render delivery config (render-delivery phase section 1) - nullable so existing rows predating this column read back as null; the repository maps that to EMPTY_RENDER_OUTPUTS, never a crash. Updated in place (see updateRenderOutput) - never bumps revision, since choosing a render target isn't scene CONTENT requiring re-approval. */
    renderOutputs: jsonb("render_outputs").$type<RenderOutputs>(),
    /**
     * SUPERSEDED 2026-08-27 by execution_sessions (see that table's own doc
     * comment) - no longer written to by any application code. Left in
     * place rather than dropped (no destructive migration): these columns
     * used to track the MOST RECENT successfully-completed EXECUTE_FRAME
     * job's own self-reported working-copy identity, updated in place on
     * every success, which meant they reflected whichever scene was edited
     * LAST, never a cumulative multi-scene edit session. That exact gap is
     * what execution_sessions.latestWorkingProjectSha256 (accumulated
     * across every scene in one session, chained by expected-sha checks)
     * now solves - see resolve-render-dispatch.ts's current doc comment.
     */
    workingProjectPath: text("working_project_path"),
    workingProjectSha256: text("working_project_sha256"),
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
 * PROJECT EXECUTION SESSION (multi-scene-accumulation phase, section 2) -
 * binds one source .aep + one execution-plan revision + one assigned
 * Worker + one cumulative Worker-local working copy across many sequential
 * EXECUTE_FRAME jobs and both output renders. Replaces execution_plans'
 * own now-superseded workingProjectPath/workingProjectSha256 columns
 * (which reflected only whichever ONE scene was edited most recently).
 *
 * `assignedWorkerId` is pinned for the session's entire lifetime (worker
 * affinity - section 8): the cumulative working copy lives on that one
 * worker's local disk, so no later scene-edit/render job for this session
 * may ever be dispatched to a different worker. `planRevision`/
 * `sourceProjectSha256` are copied at creation time, never re-joined live
 * (same "bound to the exact revision it was built for" rule as
 * execution_plans.sourceProjectSha256) - if the plan changes after a
 * session begins, dispatch fails closed (stale-session precondition, never
 * silently mixes operations from two revisions - section 11) rather than
 * this row being updated.
 *
 * `completedScenePlanIds` accumulates one entry per successful EXECUTE_FRAME
 * job (see record-execute-frame-result.ts) - this is the durable proof
 * scene edits are landing in the SAME cumulative copy rather than
 * independent ones. `latestWorkingProjectSha256` is the chain-of-custody
 * head: null until the session's first scene succeeds, then updated
 * in-place after every subsequent success - the NEXT scene job's own
 * dispatch payload asserts this exact value as its
 * `expectedWorkingProjectSha256` (see resolve-execute-frame-dispatch.ts),
 * and the worker fails closed if what's actually on disk disagrees.
 *
 * `status` is mostly a derived/informational field (see
 * apps/api/src/domain/execution-session/derive-status.ts) - RENDERING/
 * PAUSED are computed at read time from live worker/job state and never
 * persisted here.
 *
 * Cleanup policy (section 15): no code anywhere ever deletes a row from
 * this table. A row reaching COMPLETED (see record-render-artifact.ts's
 * own session side effect) stays recoverable for a SECOND render of the
 * other variant against the exact same cumulative working copy - project
 * deletion cascades (onDelete cascade on project_id above) are the only
 * removal path, same as every other project-scoped table here.
 */
export const executionSessions = pgTable(
  "execution_sessions",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => executionPlans.id, { onDelete: "cascade" }),
    planRevision: integer("plan_revision").notNull(),
    sourceProjectSha256: text("source_project_sha256").notNull(),
    assignedWorkerId: uuid("assigned_worker_id")
      .notNull()
      .references(() => workers.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("PREPARING").$type<ExecutionSessionStatus>(),
    latestWorkingProjectSha256: text("latest_working_project_sha256"),
    completedScenePlanIds: jsonb("completed_scene_plan_ids").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
    firstPreviewApproved: boolean("first_preview_approved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("execution_sessions_status_check", sql.raw(sqlEnumCheck("status", DB_EXECUTION_SESSION_STATUSES))),
    check("execution_sessions_plan_revision_check", sql`${table.planRevision} > 0`)
  ]
);

export type ExecutionSessionRow = typeof executionSessions.$inferSelect;
export type NewExecutionSessionRow = typeof executionSessions.$inferInsert;

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

export const DB_SUGGESTION_SOURCES = ["DETERMINISTIC", "AI"] as const;
export const DB_SUGGESTION_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;

/**
 * Mapping Assistant suggestions (evidence-backed mapping suggestions
 * phase) - never itself a PlaceholderMapping. `suggestedAssetId` is
 * deliberately NOT a foreign key: it is re-validated against the real
 * Asset Catalog at accept time (see accept-mapping-suggestion.ts), so an
 * asset deleted after a suggestion was generated fails there with a clear
 * reason rather than the DB silently blocking/cascading the deletion on
 * a suggestion's behalf. `scenePlanId`/`mappingId` reference ids inside
 * execution_plans.scene_plans' own jsonb (not a separate table), so they
 * are plain text columns, not FKs, matching how the plan itself models
 * scenes/mappings. At most one PENDING row is kept per (projectId,
 * scenePlanId, mappingId) target - enforced at the application layer
 * (upsertPending), not a DB constraint, since mappingId can be NULL for a
 * composition-level-only unresolved scene and Postgres unique
 * constraints never treat two NULLs as duplicates.
 */
export const mappingSuggestions = pgTable(
  "mapping_suggestions",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scenePlanId: text("scene_plan_id").notNull(),
    mappingId: text("mapping_id"),
    source: text("source").notNull().$type<SuggestionSource>(),
    status: text("status").notNull().default("PENDING").$type<SuggestionStatus>(),
    suggestedClassification: text("suggested_classification").$type<PlaceholderType | null>(),
    suggestedAssetId: uuid("suggested_asset_id"),
    suggestedText: text("suggested_text"),
    suggestedAssetTimestamp: doublePrecision("suggested_asset_timestamp"),
    suggestedFinalDuration: doublePrecision("suggested_final_duration"),
    confidence: doublePrecision("confidence").notNull(),
    reasoning: text("reasoning"),
    evidenceRefs: jsonb("evidence_refs").notNull().$type<EvidenceRef[]>(),
    unresolvedReason: text("unresolved_reason"),
    requiresHumanReview: boolean("requires_human_review").notNull(),
    conflictsWithWorkMap: boolean("conflicts_with_work_map").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("mapping_suggestions_source_check", sql.raw(sqlEnumCheck("source", DB_SUGGESTION_SOURCES))),
    check("mapping_suggestions_status_check", sql.raw(sqlEnumCheck("status", DB_SUGGESTION_STATUSES))),
    check("mapping_suggestions_confidence_check", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`)
  ]
);
export type MappingSuggestionRow = typeof mappingSuggestions.$inferSelect;
export type NewMappingSuggestionRow = typeof mappingSuggestions.$inferInsert;

/**
 * Durable, append-only, read-only record of one successful
 * INSPECT_SCENE_EVIDENCE job result (Phase 7B operation, persisted here for
 * the first time - see docs/engineering audit for this phase). Never
 * updated in place: a re-inspection always INSERTs a new row rather than
 * overwriting an older one, so historical evidence is never silently lost
 * even after the project's source .aep changes (evidence-persistence phase
 * section 2/3). `jobId` is unique - at most one evidence row per job,
 * guarding the write path (record-scene-evidence.ts) against ever creating
 * a duplicate from a retried/duplicate callback, defense in depth alongside
 * the jobs table's own compare-and-swap status transition (a job can only
 * ever transition into SUCCEEDED once).
 */
export const sceneEvidence = pgTable(
  "scene_evidence",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .unique()
      .references(() => jobs.id, { onDelete: "cascade" }),
    manifestCompositionId: text("manifest_composition_id").notNull(),
    /** The worker's own re-verified sha256 (SceneEvidenceResponse.verifiedSourceProjectSha256) - never re-derived, never trusted from the request alone. */
    sourceProjectSha256: text("source_project_sha256").notNull(),
    /** Full validated SceneEvidenceResponse - validated by record-scene-evidence.ts BEFORE this row is ever inserted, never stored unvalidated. */
    response: jsonb("response").notNull().$type<SceneEvidenceResponse>(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  () => []
);
export type SceneEvidenceRow = typeof sceneEvidence.$inferSelect;
export type NewSceneEvidenceRow = typeof sceneEvidence.$inferInsert;

export const DB_RENDER_OUTPUT_VARIANTS = ["LANDSCAPE", "REELS"] as const;
export const DB_RENDER_ARTIFACT_VALIDATION_STATUSES = ["VALID", "INVALID"] as const;

/**
 * Durable METADATA-only record of one successful RENDER job's own artifact
 * (render-engine phase section 11/12) - mirrors scene_evidence's own
 * "append-only, jobId-unique" pattern exactly. Deliberately carries NO
 * filesystem path (worker-local paths never cross into this table - see
 * docs/engineering/SECURITY.md). `storageKey`/`sha256` bind this row to
 * REAL, server-verified uploaded bytes (see render_artifact_uploads and
 * record-render-artifact.ts) - a row is only ever inserted once a matching
 * upload already exists, so a render_artifacts row is never downloadable
 * metadata for bytes that don't actually exist in storage. Only ever
 * inserted for a job whose reported result's `validationStatus` is
 * "VALID" AND whose bytes were genuinely uploaded and verified.
 */
export const renderArtifacts = pgTable(
  "render_artifacts",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .unique()
      .references(() => jobs.id, { onDelete: "cascade" }),
    variant: text("variant").notNull().$type<RenderOutputVariant>(),
    compositionName: text("composition_name").notNull(),
    workingProjectSha256: text("working_project_sha256").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    /** Opaque AssetStorage identifier for the REAL uploaded bytes - never a filesystem path exposed to a browser. Server-verified at upload time (see render_artifact_uploads), never worker-self-reported. */
    storageKey: text("storage_key").notNull(),
    /** Server-computed from the actual uploaded bytes - never trusted from the worker's own claim alone. */
    sha256: text("sha256").notNull(),
    renderStartedAt: timestamp("render_started_at", { withTimezone: true }).notNull(),
    renderCompletedAt: timestamp("render_completed_at", { withTimezone: true }).notNull(),
    aerenderExitCode: integer("aerender_exit_code").notNull(),
    logExcerpt: text("log_excerpt"),
    validationStatus: text("validation_status").notNull().$type<RenderArtifactValidationStatus>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("render_artifacts_variant_check", sql.raw(sqlEnumCheck("variant", DB_RENDER_OUTPUT_VARIANTS))),
    check("render_artifacts_validation_status_check", sql.raw(sqlEnumCheck("validation_status", DB_RENDER_ARTIFACT_VALIDATION_STATUSES))),
    check("render_artifacts_byte_size_check", sql`${table.byteSize} >= 0`),
    unique("render_artifacts_storage_key_unique").on(table.storageKey)
  ]
);
export type RenderArtifactRow = typeof renderArtifacts.$inferSelect;
export type NewRenderArtifactRow = typeof renderArtifacts.$inferInsert;

/**
 * Real, server-verified uploaded bytes for ONE render job (render-delivery
 * phase section 4) - written by the worker-authenticated artifact-upload
 * endpoint BEFORE the job's own final status report, deliberately kept
 * separate from render_artifacts (which describes the finished, delivered
 * result). record-render-artifact.ts's job-report side effect only ever
 * creates a render_artifacts row once a matching row here already exists -
 * a job that reports SUCCEEDED without ever having uploaded real bytes
 * never becomes a downloadable artifact. `job_id` unique: idempotent by
 * job, mirroring scene_evidence/render_artifacts' own convention - a
 * retried/duplicate upload for the same job replaces this row's content
 * (see upload-render-artifact.ts) rather than ever creating a second one.
 */
export const renderArtifactUploads = pgTable(
  "render_artifact_uploads",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .unique()
      .references(() => jobs.id, { onDelete: "cascade" }),
    variant: text("variant").notNull().$type<RenderOutputVariant>(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("render_artifact_uploads_variant_check", sql.raw(sqlEnumCheck("variant", DB_RENDER_OUTPUT_VARIANTS))),
    check("render_artifact_uploads_byte_size_check", sql`${table.byteSize} >= 0`),
    unique("render_artifact_uploads_storage_key_unique").on(table.storageKey)
  ]
);
export type RenderArtifactUploadRow = typeof renderArtifactUploads.$inferSelect;
export type NewRenderArtifactUploadRow = typeof renderArtifactUploads.$inferInsert;
