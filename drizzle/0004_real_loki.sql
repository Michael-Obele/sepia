ALTER TABLE "entities" ADD COLUMN "tags" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "tags" text[] DEFAULT '{}';--> statement-breakpoint
CREATE INDEX "idx_entities_tags" ON "entities" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_memories_tags" ON "memories" USING gin ("tags");