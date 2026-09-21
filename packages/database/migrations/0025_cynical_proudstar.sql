ALTER TABLE "assets" ADD COLUMN "has_alpha_channel" boolean;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "pixel_analysis" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "has_transparent_pixels" boolean;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "transparent_pixel_ratio" double precision;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "visible_coverage_ratio" double precision;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "visible_content_bounds" jsonb;