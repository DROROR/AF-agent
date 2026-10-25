ALTER TABLE "render_artifact_uploads" DROP CONSTRAINT "render_artifact_uploads_variant_check";--> statement-breakpoint
ALTER TABLE "render_artifacts" DROP CONSTRAINT "render_artifacts_variant_check";--> statement-breakpoint
ALTER TABLE "render_artifact_uploads" ADD CONSTRAINT "render_artifact_uploads_variant_check" CHECK (variant in ('LANDSCAPE', 'REELS', 'SQUARE'));--> statement-breakpoint
ALTER TABLE "render_artifacts" ADD CONSTRAINT "render_artifacts_variant_check" CHECK (variant in ('LANDSCAPE', 'REELS', 'SQUARE'));