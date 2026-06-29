ALTER TABLE "web_access_sessions" ADD COLUMN "browser_token_hash" text;--> statement-breakpoint
UPDATE "web_access_sessions"
SET "browser_token_hash" = md5(gen_random_uuid()::text || ':' || "id"::text || ':web-access-browser')
  || md5("id"::text || ':' || gen_random_uuid()::text)
WHERE "browser_token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "web_access_sessions" ALTER COLUMN "browser_token_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "web_access_sessions_browser_token_hash_unique" ON "web_access_sessions" ("browser_token_hash");
