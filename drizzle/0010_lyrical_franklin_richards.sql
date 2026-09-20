-- BM25 ranked search (Neon Lakebase Search / Databricks).
--
-- Drizzle cannot express extensions or access methods, so these two statements
-- are hand-written. The columns are ordinary `tsvector`; only the index access
-- method differs from a GIN index. `b = 0` disables BM25 length normalisation,
-- which was measured against this corpus: with the default b = 0.75 the correct
-- 2,259-char memory ranked 6th for its own query, 3rd at b = 0.4, 1st at b = 0.
-- `default_limit` is the top-K pushdown (default 1000); keep it near the query
-- LIMIT. Note Neon removed `pg_search` on 2026-09-21 — `lakebase_text` is the
-- supported path and requires Postgres 16+.
CREATE EXTENSION IF NOT EXISTS lakebase_text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "haystack_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(summary, ''))) STORED;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED;--> statement-breakpoint
CREATE INDEX "entities_haystack_bm25" ON "entities" USING lakebase_bm25 ("haystack_tsv") WITH (b=0,default_limit=100);--> statement-breakpoint
CREATE INDEX "memories_content_bm25" ON "memories" USING lakebase_bm25 ("content_tsv") WITH (b=0,default_limit=100);