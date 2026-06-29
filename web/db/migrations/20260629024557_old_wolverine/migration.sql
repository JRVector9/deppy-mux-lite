CREATE TABLE "web_access_rpc_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL,
	"method" text NOT NULL,
	"params" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "web_access_rpc_requests_slug_status_created_idx" ON "web_access_rpc_requests" ("slug","status","created_at");--> statement-breakpoint
CREATE INDEX "web_access_rpc_requests_expires_idx" ON "web_access_rpc_requests" ("expires_at");