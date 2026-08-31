CREATE TABLE IF NOT EXISTS "scene_evidence_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"manifest_composition_id" text NOT NULL,
	"source_project_sha256" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_evidence_previews_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "scene_evidence_previews_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "scene_evidence_previews_byte_size_check" CHECK ("scene_evidence_previews"."byte_size" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scene_evidence_previews" ADD CONSTRAINT "scene_evidence_previews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scene_evidence_previews" ADD CONSTRAINT "scene_evidence_previews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
