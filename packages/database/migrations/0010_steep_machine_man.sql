CREATE TABLE IF NOT EXISTS "render_artifact_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_artifact_uploads_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "render_artifact_uploads_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "render_artifact_uploads_variant_check" CHECK (variant in ('LANDSCAPE', 'REELS')),
	CONSTRAINT "render_artifact_uploads_byte_size_check" CHECK ("render_artifact_uploads"."byte_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "render_artifacts" ADD COLUMN "storage_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "render_artifacts" ADD COLUMN "sha256" text NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "render_artifact_uploads" ADD CONSTRAINT "render_artifact_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "render_artifact_uploads" ADD CONSTRAINT "render_artifact_uploads_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "render_artifacts" ADD CONSTRAINT "render_artifacts_storage_key_unique" UNIQUE("storage_key");