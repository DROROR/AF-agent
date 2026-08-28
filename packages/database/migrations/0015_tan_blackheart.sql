CREATE TABLE IF NOT EXISTS "user_ai_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"last4" text NOT NULL,
	"model" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ai_providers_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_ai_providers_provider_check" CHECK (provider in ('ANTHROPIC'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_ai_providers" ADD CONSTRAINT "user_ai_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
