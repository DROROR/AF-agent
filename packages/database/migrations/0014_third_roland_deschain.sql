ALTER TABLE "execution_sessions" ADD COLUMN "latest_preview_storage_key" text;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD COLUMN "latest_preview_sha256" text;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD COLUMN "latest_preview_scene_plan_id" text;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD COLUMN "latest_preview_captured_at" timestamp with time zone;