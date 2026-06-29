ALTER TABLE "web_access_rpc_requests" ADD COLUMN "status_token_hash" text;
--> statement-breakpoint
UPDATE "web_access_rpc_requests"
SET "status_token_hash" = md5(gen_random_uuid()::text || ':' || "id"::text || ':web-access-status')
  || md5("id"::text || ':' || gen_random_uuid()::text)
WHERE "status_token_hash" IS NULL;
--> statement-breakpoint
ALTER TABLE "web_access_rpc_requests" ALTER COLUMN "status_token_hash" SET NOT NULL;
