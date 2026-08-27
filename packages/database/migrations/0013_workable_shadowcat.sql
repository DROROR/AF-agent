CREATE TABLE IF NOT EXISTS "execution_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"execution_plan_id" uuid NOT NULL,
	"plan_revision" integer NOT NULL,
	"source_project_sha256" text NOT NULL,
	"assigned_worker_id" uuid NOT NULL,
	"status" text DEFAULT 'PREPARING' NOT NULL,
	"latest_working_project_sha256" text,
	"completed_scene_plan_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_preview_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_sessions_status_check" CHECK (status in ('PREPARING', 'EDITING', 'AWAITING_PREVIEW_APPROVAL', 'READY_TO_RENDER', 'RENDERING', 'COMPLETED', 'PAUSED', 'FAILED')),
	CONSTRAINT "execution_sessions_plan_revision_check" CHECK ("execution_sessions"."plan_revision" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_sessions" ADD CONSTRAINT "execution_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_sessions" ADD CONSTRAINT "execution_sessions_execution_plan_id_execution_plans_id_fk" FOREIGN KEY ("execution_plan_id") REFERENCES "public"."execution_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_sessions" ADD CONSTRAINT "execution_sessions_assigned_worker_id_workers_id_fk" FOREIGN KEY ("assigned_worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
