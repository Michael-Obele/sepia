CREATE TABLE "oauth_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"access_token" text PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"client_id" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_tokens_refresh_token_key" UNIQUE("refresh_token")
);
--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_oauth_codes_client" ON "oauth_codes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_tokens_client" ON "oauth_tokens" USING btree ("client_id");