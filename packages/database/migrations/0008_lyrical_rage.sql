CREATE TABLE IF NOT EXISTS "render_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"composition_name" text NOT NULL,
	"working_project_sha256" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"render_started_at" timestamp with time zone NOT NULL,
	"render_completed_at" timestamp with time zone NOT NULL,
	"aerender_exit_code" integer NOT NULL,
	"log_excerpt" text,
	"validation_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_artifacts_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "render_artifacts_variant_check" CHECK (variant in ('LANDSCAPE', 'REELS')),
	CONSTRAINT "render_artifacts_validation_status_check" CHECK (validation_status in ('VALID', 'INVALID')),
	CONSTRAINT "render_artifacts_byte_size_check" CHECK ("render_artifacts"."byte_size" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "render_artifacts" ADD CONSTRAINT "render_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "render_artifacts" ADD CONSTRAINT "render_artifacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
