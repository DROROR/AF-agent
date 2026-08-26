CREATE TABLE IF NOT EXISTS "execution_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"template_id" text NOT NULL,
	"source_project_sha256" text NOT NULL,
	"scene_plans" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_plans_project_revision_unique" UNIQUE("project_id","revision"),
	CONSTRAINT "execution_plans_status_check" CHECK (status in ('DRAFT', 'APPROVED', 'REJECTED')),
	CONSTRAINT "execution_plans_revision_check" CHECK ("execution_plans"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"source_project_sha256" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_plans" ADD CONSTRAINT "execution_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_plans" ADD CONSTRAINT "execution_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
