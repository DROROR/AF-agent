CREATE TABLE IF NOT EXISTS "mapping_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"scene_plan_id" text NOT NULL,
	"mapping_id" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"suggested_classification" text,
	"suggested_asset_id" uuid,
	"suggested_text" text,
	"suggested_asset_timestamp" double precision,
	"suggested_final_duration" double precision,
	"confidence" double precision NOT NULL,
	"reasoning" text,
	"evidence_refs" jsonb NOT NULL,
	"unresolved_reason" text,
	"requires_human_review" boolean NOT NULL,
	"conflicts_with_work_map" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_suggestions_source_check" CHECK (source in ('DETERMINISTIC', 'AI')),
	CONSTRAINT "mapping_suggestions_status_check" CHECK (status in ('PENDING', 'ACCEPTED', 'REJECTED')),
	CONSTRAINT "mapping_suggestions_confidence_check" CHECK ("mapping_suggestions"."confidence" >= 0 AND "mapping_suggestions"."confidence" <= 1)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mapping_suggestions" ADD CONSTRAINT "mapping_suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
