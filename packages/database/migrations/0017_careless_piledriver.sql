CREATE TABLE IF NOT EXISTS "full_preview_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"execution_session_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"working_project_sha256" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "full_preview_artifacts_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "full_preview_artifacts_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "full_preview_artifacts_byte_size_check" CHECK ("full_preview_artifacts"."byte_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD COLUMN "full_preview_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "full_preview_artifacts" ADD CONSTRAINT "full_preview_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "full_preview_artifacts" ADD CONSTRAINT "full_preview_artifacts_execution_session_id_execution_sessions_id_fk" FOREIGN KEY ("execution_session_id") REFERENCES "public"."execution_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "full_preview_artifacts" ADD CONSTRAINT "full_preview_artifacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
