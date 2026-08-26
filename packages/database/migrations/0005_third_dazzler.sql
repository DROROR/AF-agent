CREATE TABLE IF NOT EXISTS "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"media_kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" double precision,
	"label" text,
	"notes" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "assets_media_kind_check" CHECK (media_kind in ('IMAGE', 'VIDEO', 'LOGO', 'AUDIO', 'DOCUMENT', 'OTHER')),
	CONSTRAINT "assets_byte_size_check" CHECK ("assets"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_work_maps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"entries" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_work_maps_project_revision_unique" UNIQUE("project_id","revision"),
	CONSTRAINT "project_work_maps_revision_check" CHECK ("project_work_maps"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "brand_inputs" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_work_maps" ADD CONSTRAINT "project_work_maps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
