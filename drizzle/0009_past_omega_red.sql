CREATE TABLE "telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"session_hash" text,
	"tool" text NOT NULL,
	"action" text,
	"engine" text,
	"query_fingerprint" text,
	"terms" integer,
	"best_matched_terms" integer,
	"hit_count" integer,
	"latency_ms" integer,
	"result_chars" integer,
	"query_text" text,
	"hit_ids" uuid[]
);
--> statement-breakpoint
CREATE TABLE "telemetry_settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'off' NOT NULL,
	"ttl_days" integer DEFAULT 30 NOT NULL,
	"enabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "telemetry_settings_tier_check" CHECK ("telemetry_settings"."tier" IN ('off', 'signals', 'transcripts')),
	CONSTRAINT "telemetry_settings_ttl_check" CHECK ("telemetry_settings"."ttl_days" >= 1 AND "telemetry_settings"."ttl_days" <= 365)
);
--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_settings" ADD CONSTRAINT "telemetry_settings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_telemetry_events_owner" ON "telemetry_events" USING btree ("owner_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_telemetry_events_session" ON "telemetry_events" USING btree ("session_hash" text_ops);