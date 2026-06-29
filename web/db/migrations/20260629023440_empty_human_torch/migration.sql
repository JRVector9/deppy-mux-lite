CREATE TABLE "web_access_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL,
	"host_token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"device_id" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_host_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "web_access_sessions_slug_unique" ON "web_access_sessions" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "web_access_sessions_host_token_hash_unique" ON "web_access_sessions" ("host_token_hash");--> statement-breakpoint
CREATE INDEX "web_access_sessions_owner_expires_idx" ON "web_access_sessions" ("team_id","user_id","expires_at");--> statement-breakpoint
CREATE INDEX "web_access_sessions_expires_idx" ON "web_access_sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "web_access_sessions_owner_device_idx" ON "web_access_sessions" ("team_id","user_id","device_id") WHERE "device_id" is not null;