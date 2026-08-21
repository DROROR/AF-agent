CREATE TABLE IF NOT EXISTS "workers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'OFFLINE' NOT NULL,
	"ae_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"mcp_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"ae_version" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"current_job_id" uuid,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workers_status_check" CHECK (status in ('ONLINE', 'OFFLINE')),
	CONSTRAINT "workers_ae_status_check" CHECK (ae_status in ('ONLINE', 'OFFLINE', 'UNKNOWN')),
	CONSTRAINT "workers_mcp_status_check" CHECK (mcp_status in ('ONLINE', 'OFFLINE', 'UNKNOWN')),
	CONSTRAINT "workers_max_concurrency_check" CHECK ("workers"."max_concurrency" > 0)
);
