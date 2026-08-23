CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"checkpoint" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_operation_check" CHECK (operation in ('CHECK_HEALTH', 'INSPECT_TEMPLATE', 'VALIDATE_PLAN', 'PREPARE_PROJECT', 'EXECUTE_FRAME', 'APPLY_BRANDING', 'CREATE_PREVIEW', 'CREATE_HORIZONTAL', 'CREATE_REELS', 'PREPARE_RENDER', 'RENDER', 'RESUME_JOB')),
	CONSTRAINT "jobs_status_check" CHECK (status in ('QUEUED', 'CLAIMED', 'RUNNING', 'WAITING_FOR_ACTION', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workers" ADD CONSTRAINT "workers_current_job_id_jobs_id_fk" FOREIGN KEY ("current_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
