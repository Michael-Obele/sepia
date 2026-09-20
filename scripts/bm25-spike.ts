/**
 * BM25 spike — setup, recall comparison, and A/B ranking measurement.
 *
 * The behaviour under test: union the candidate sets (recall) then order by BM25
 * (ranking), falling back to today's coverage score when BM25 has no signal.
 *
 * ANSWERS IT PRODUCED (2026-09-20): yes — `to_tsquery('english', 'migr:*')`
 * recovers 97% of substring recall for prefixes and 79% for compound words
 * (`svelte:*` matches SvelteKit via 'svelt'), so the trigram leg is NOT required
 * for recall. The residual loss is INFIX matching only, which is acceptable.
 *
 * ⚠ STATE: the objects `setup` creates are ALREADY APPLIED to the production
 * database — the `lakebase_text` extension, `memories.content_tsv`,
 * `entities.haystack_tsv`, and two `lakebase_bm25` indexes. They are deliberately
 * NOT in `schema.ts` yet, so `db:generate` will not emit them, and `search()`
 * does not read them (behaviour is unchanged). When the real BM25 slice lands it
 * must ADOPT these columns in `schema.ts` instead of creating them a second time,
 * and this script's teardown should then be dropped.
 *
 * Usage: bun run scripts/bm25-spike.ts [setup|recall|rank|teardown|all]
 */
import { neon } from "@neondatabase/serverless";
import { db } from "../src/db.ts";
import { search } from "@sepia/shared";

const sql = neon(process.env.DATABASE_URL!);
const conn = db();
const action = process.argv[2] ?? "all";
const short = (s: string, n = 62) => (s ?? "").replace(/\s+/g, " ").slice(0, n);

const MEM_IDX = "memories_content_bm25";
const ENT_IDX = "entities_haystack_bm25";
/** b = 0 disables length normalisation. Sepia memory lengths span 2 orders of
 *  magnitude, and the default b=0.75 demoted the correct long memory to rank 6. */
const B = "0.0";
const DEFAULT_LIMIT = 100;

async function setup() {
  console.log("── setup ──");
  await sql`CREATE EXTENSION IF NOT EXISTS lakebase_text`;
  // Additive only: new generated columns, existing ones untouched.
  await sql`ALTER TABLE memories ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED`;
  await sql`ALTER TABLE entities ADD COLUMN IF NOT EXISTS haystack_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(summary,''))) STORED`;
  // BM25 stats are computed at build time, so the index is created AFTER the
  // generated columns have been backfilled by the ALTER.
  await sql`DROP INDEX IF EXISTS memories_content_bm25`;
  await sql`DROP INDEX IF EXISTS entities_haystack_bm25`;
  await sql.query(
    `CREATE INDEX ${MEM_IDX} ON memories USING lakebase_bm25 (content_tsv) WITH (default_limit = ${DEFAULT_LIMIT}, b = ${B})`,
  );
  await sql.query(
    `CREATE INDEX ${ENT_IDX} ON entities USING lakebase_bm25 (haystack_tsv) WITH (default_limit = ${DEFAULT_LIMIT}, b = ${B})`,
  );
  const n = (await sql`SELECT count(*)::int AS n FROM memories WHERE content_tsv IS NOT NULL`) as Array<{ n: number }>;
  console.log(`  ✓ extension + 2 generated columns + 2 bm25 indexes (b=${B}, default_limit=${DEFAULT_LIMIT}); ${n[0]!.n} memories indexed`);
}

/** Prefix-aware OR tsquery: matches lexemes STARTING WITH each term. */
const prefixQuery = (terms: string[]) =>
  terms.length ? terms.map((t) => `${t}:*`).join(" | ") : "zzzznomatch";

async function recall() {
  console.log("── recall: can prefix-aware tsquery match what substring search matches? ──");
  const probes = ["migr", "migration", "classif", "classifier", "svelte", "sveltekit", "showcase", "bunx", "effing"];
  console.log("   probe           ILIKE   tokens   prefix:*   prefix%ofILIKE");
  for (const p of probes) {
    const like = (await sql`SELECT count(*)::int AS n FROM memories WHERE content ILIKE ${"%" + p + "%"}`) as Array<{ n: number }>;
    const tok = (await sql`SELECT count(*)::int AS n FROM memories WHERE content_tsv @@ to_tsquery('english', ${p})`) as Array<{ n: number }>;
    const pre = (await sql`SELECT count(*)::int AS n FROM memories WHERE content_tsv @@ to_tsquery('english', ${p + ":*"})`) as Array<{ n: number }>;
    const pct = Math.round((pre[0]!.n / Math.max(like[0]!.n, 1)) * 100);
    console.log(
      `   ${p.padEnd(14)} ${String(like[0]!.n).padStart(6)} ${String(tok[0]!.n).padStart(8)} ${String(pre[0]!.n).padStart(10)}   ${String(pct).padStart(3)}%`,
    );
  }
}

const TERMS_OF = (q: string) => q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const escapeTq = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "");

async function rank() {
  console.log("── ranking A/B on real queries ──");
  const owner = String(
    ((await sql`
      SELECT n.owner_id AS owner FROM namespaces n JOIN memories m ON m.namespace_id = n.id
       WHERE n.name = 'personal' GROUP BY n.owner_id ORDER BY count(m.id)::int DESC LIMIT 1
    `) as Array<{ owner: string }>)[0]!.owner,
  );
  const orQ = (q: string) => prefixQuery(TERMS_OF(q).map(escapeTq).filter(Boolean));

  for (const q of [
    "classifier local CPU model embeddings Rust",
    "gap analysis roadmap curation memory",
    "download size before install",
    "svelte runes",
    "migr",
  ]) {
    const terms = TERMS_OF(q).map(escapeTq).filter(Boolean);
    const pats = terms.map((t) => `%${t}%`);

    const base = (await search(conn, owner, { q, namespace: "personal", limit: 5 })).filter(
      (h) => h.kind === "memory",
    );

    // Union of (substring match) OR (prefix-aware token match), ordered by BM25
    // then by today's coverage score. The bm25 score is compared only when the
    // row has token signal; substring-only matches fall back to coverage order.
    const rows = (await sql`
      SELECT m.id, m.content,
             m.content_tsv <@> to_bm25query(to_tsvector('english', ${q}), ${MEM_IDX}) AS bm,
             (m.content_tsv @@ to_tsquery('english', ${orQ(q)})) AS sig
        FROM memories m JOIN namespaces n ON n.id = m.namespace_id
       WHERE m.archived IS NOT TRUE AND n.owner_id = ${owner} AND n.name = 'personal'
         AND (m.content_tsv @@ to_tsquery('english', ${orQ(q)})
              OR ${sql.unsafe("m.content ILIKE ANY(" + "ARRAY[" + pats.map((p) => `'${p}'`).join(",") + "]::text[])")})
       ORDER BY sig DESC, bm ASC
       LIMIT 5`) as Array<{ content: string; bm: number; sig: boolean }>;

    console.log(`\n  ── ${JSON.stringify(q)} ──`);
    console.log("     current:");
    base.slice(0, 3).forEach((h) => console.log(`       ${short(h.content ?? "")}`));
    console.log("     union+BM25:");
    rows.slice(0, 3).forEach((r) => console.log(`       ${short(r.content)}  (bm=${r.bm.toFixed(1)}, sig=${r.sig})`));
  }
}

async function teardown() {
  console.log("── teardown ──");
  await sql`DROP INDEX IF EXISTS memories_content_bm25`;
  await sql`DROP INDEX IF EXISTS entities_haystack_bm25`;
  await sql`ALTER TABLE memories DROP COLUMN IF EXISTS content_tsv`;
  await sql`ALTER TABLE entities DROP COLUMN IF EXISTS haystack_tsv`;
  console.log("  ✓ columns + indexes dropped (extension left installed)");
}

if (action === "setup" || action === "all") await setup();
if (action === "recall" || action === "all") await recall();
if (action === "rank" || action === "all") await rank();
if (action === "teardown") await teardown();
